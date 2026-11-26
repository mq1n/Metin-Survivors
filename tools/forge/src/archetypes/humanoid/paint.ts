// Humanoid paint: skin + face, then one layer group per outfit piece (paint order = piece order, so outer pieces cover
// inner ones), each with a material family look (cloth weave, leather grain, brushed steel, lacquer + gold ornament...).
// Albedo is baked per texel; the shade stack (AO / cavity / hemi / rim) goes to COLOR_0.
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, furClumps, grain, hemi, layer, rimTint, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';
import type { AppliedPiece } from './outfit/index.ts';
import type { HumanoidParams } from './params.ts';

export interface HumanoidPaint {
  albedo: PaintLayer[];
  shade: PaintLayer[];
  emissive?: PaintLayer[];
}

const family = (mat: string): string => mat.replace(/[0-9]+$/, '');

// region masks are SDF distance queries: memoise them per texel/vertex (a piece layer group asks for the same mask many times)
const regionCache = new WeakMap<PaintVertex, Map<string, number>>();
function R(v: PaintVertex, tag: string, soft: number): number {
  let m = regionCache.get(v);
  if (!m) regionCache.set(v, (m = new Map()));
  const key = `${tag}|${soft}`;
  let r = m.get(key);
  if (r === undefined) m.set(key, (r = v.region(tag, soft)));
  return r;
}

export function makePaint(a: Anatomy, p: HumanoidParams, pieces: AppliedPiece[]): HumanoidPaint {
  const pal = (key: string, fallback = '#808080'): Rgb => rgb(p.palette[key] ?? fallback);
  const skin = rgb(p.skin.base), skinShade = rgb(p.skin.shade);
  const out: PaintLayer[] = [fill(skin)];

  // ---------------- skin
  out.push(custom('skin', (v) => {
    // gentle large-scale tone variation + warm flush in the cheeks / nose / knuckles + shadowed creases
    const n = v.noise.fbm(v.p[0] * 9, v.p[1] * 9, v.p[2] * 9, { octaves: 3 });
    v.color = mixRgb(v.color, skinShade, clamp01(0.18 + n * 0.25) * 0.6);
    const cheek = v.region('cheek', 0.03);
    if (cheek > 0) v.color = mixRgb(v.color, mixRgb(skin, rgb('#c4605a'), 0.5), cheek * 0.35);
    const nose = v.region('nosetip', 0.012);
    if (nose > 0) v.color = mixRgb(v.color, mixRgb(skin, rgb('#c4605a'), 0.6), nose * 0.5);
    const hand = v.region('hand', 0.006);
    if (hand > 0) v.color = mixRgb(v.color, skinShade, hand * 0.12);
    if (a.p.head !== 'wolf') {
      const lip = v.region('lip', 0.004);
      if (lip > 0) v.color = mixRgb(v.color, rgb(p.skin.lip), lip * 0.85);
      const lipline = v.region('lipline', 0.0025);
      if (lipline > 0) v.color = mixRgb(v.color, mixRgb(rgb(p.skin.lip), rgb('#201010'), 0.6), lipline * 0.95);
    }
    const nail = v.region('nail', 0.003);
    if (nail > 0) v.color = mixRgb(v.color, mixRgb(skin, rgb('#f0d8cc'), 0.6), nail * 0.8);
    const gap = v.region('fingergap', 0.0016);
    if (gap > 0) v.color = mixRgb(v.color, mixRgb(skinShade, rgb('#201008'), 0.5), gap * 0.9);
    const brow = v.region('brow', 0.009);
    if (brow > 0) v.color = mixRgb(v.color, rgb(p.skin.brow), brow * (a.p.head === 'wolf' ? 0.4 : 0.55 * (0.7 + 0.3 * (1 - a.fem))));
    const lid = v.region('lid', 0.004);
    if (lid > 0) v.color = mixRgb(v.color, mixRgb(skinShade, rgb('#1a0e0c'), 0.55), lid * 0.6);
    const lidline = v.region('lidline', 0.003);
    if (lidline > 0) v.color = mixRgb(v.color, rgb('#140a08'), lidline * 0.7);
    if (p.skin.mark) {
      const ink = v.region('ink', 0.0025);
      if (ink > 0) v.color = mixRgb(v.color, rgb(p.skin.mark), ink * 0.8);
    }
  }));
  // eyes: white, iris, pupil
  out.push(custom('eyes', (v) => {
    const eye = v.region('eye', 0.0015);
    if (eye <= 0) return;
    v.color = mixRgb(v.color, mixRgb(rgb('#efe9dc'), skinShade, 0.15), eye);
    const iris = v.region('iris', 0.0018);
    if (iris > 0) v.color = mixRgb(v.color, rgb(p.skin.eye), iris);
    const pupil = v.region('pupil', 0.0012);
    if (pupil > 0) v.color = mixRgb(v.color, rgb('#050505'), pupil);
  }));
  if (a.p.head === 'wolf') {
    out.push(custom('wolfhead', (v) => {
      const fur = rgb(p.hair.color);
      const f = v.region('fur', 0.01);
      if (f > 0) v.color = mixRgb(v.color, fur, f * 0.9);
      const muz = v.region('muzzle', 0.012);
      if (muz > 0) v.color = mixRgb(v.color, mixRgb(fur, rgb(p.hair.highlight ?? '#cfc7b8'), 0.65), muz * 0.8);
      const nose = v.region('nose', 0.006);
      if (nose > 0) v.color = mixRgb(v.color, rgb('#161214'), nose);
      const inner = v.region('ear_inner', 0.005);
      if (inner > 0) v.color = mixRgb(v.color, rgb('#b07a78'), inner * 0.8);
      const fang = v.region('fang', 0.002);
      if (fang > 0) v.color = mixRgb(v.color, rgb('#ece6d4'), fang);
      const ll = v.region('lipline', 0.003);
      if (ll > 0) v.color = mixRgb(v.color, rgb('#2a1218'), ll);
    }));
  }

  // ---------------- pieces
  for (const pc of pieces) out.push(...pieceLayers(pc, a, p, pal));

  // ---------------- shade stack
  const shade: PaintLayer[] = [
    cavity(0.42, 0.16),
    bakeAo(0.62, [0.58, 0.5, 0.52], 1.2),
    hemi(rgb('#fff4e2'), rgb('#b59f86'), 0.5),
    rimTint(rgb('#ffe6c4'), { strength: 0.09 }),
  ];

  // ---------------- emissive (rune glow)
  let emissive: PaintLayer[] | undefined;
  if (p.glow) {
    const gc = rgb(p.glow.color);
    const tags = p.glow.tags;
    emissive = [custom('glow', (v) => {
      let m = 0;
      for (const t of tags) m = Math.max(m, v.region(t, 0.0022));
      if (m > 0) v.color = [gc[0] * m, gc[1] * m, gc[2] * m];
    })];
    // runes also tint the albedo so they read when unlit
    out.push(custom('glowAlbedo', (v) => {
      let m = 0;
      for (const t of tags) m = Math.max(m, v.region(t, 0.0022));
      if (m > 0) v.color = mixRgb(v.color, mixRgb(gc, rgb('#ffffff'), 0.25), m * 0.9);
    }));
  }
  return { albedo: out, shade, ...(emissive ? { emissive } : {}) };
}

const down: Vec3 = [0, -1, 0];

function pieceLayers(pc: AppliedPiece, a: Anatomy, p: HumanoidParams, pal: (k: string, f?: string) => Rgb): PaintLayer[] {
  const tag = `p${pc.i}`;
  const fam = family(pc.mat);
  const base = pal(pc.mat, fam === 'hair' ? p.hair.color : '#808080');
  const L: PaintLayer[] = [];
  const mask = (v: PaintVertex): number => R(v, tag, 0.006);
  const tint = (amt: number): number => (amt);
  void tint;
  L.push(layer(`${tag}:base`, base, mask));
  switch (fam) {
    case 'cloth':
    case 'sash':
    case 'paper': {
      L.push(strands({ flow: () => down, freq: 90, stretch: 8, amount: 0.09, octaves: 2, mask }));
      L.push(custom(`${tag}:weave`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        const w = Math.sin(v.p[1] * 900) * Math.sin((v.p[0] + v.p[2]) * 900);
        const k = 1 + 0.05 * w * m + 0.1 * v.noise.fbm(v.p[0] * 40, v.p[1] * 40, v.p[2] * 40, { octaves: 2 }) * m;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      // hem darkening on skirts
      L.push(custom(`${tag}:skirt`, (v) => {
        const m = R(v, 'skirt', 0.01);
        if (m <= 0) return;
        const k = 1 - 0.18 * smoothstep(0.75, 0.2, v.p[1]) * m;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'leather': {
      L.push(grain(0.1, 380));
      L.push(custom(`${tag}:wear`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        const n = v.noise.fbm(v.p[0] * 16, v.p[1] * 16, v.p[2] * 16, { octaves: 3 });
        const k = 1 + 0.22 * n * m + 0.28 * Math.max(0, v.cavity) * m;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'plate': {
      L.push(strands({ flow: () => [0, 1, 0.25], freq: 170, stretch: 10, amount: 0.12, octaves: 2, mask }));
      L.push(custom(`${tag}:steel`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        // sheen on upward faces, worn bright edges, dark pits
        const sheen = 0.12 * (v.n[1] * 0.5 + 0.5) * m;
        const wear = 0.5 * Math.max(0, v.cavity) * m;
        const pit = 0.1 * v.noise.fbm(v.p[0] * 70, v.p[1] * 70, v.p[2] * 70, { octaves: 2 }) * m;
        const hi = pal('plateHi', '#c8ccd2');
        v.color = mixRgb(v.color, hi, clamp01(wear * 0.7));
        const k = 1 + sheen + pit;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'lacquer': {
      const pat = String(pc.o.pattern ?? 'none');
      const goldCol = pal('gold', '#d4a640');
      L.push(custom(`${tag}:lacquer`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        // deep gloss: brighter on upward-facing surfaces, darker in the lows
        const k = 0.82 + 0.3 * (v.n[1] * 0.5 + 0.5) + 0.35 * Math.max(0, v.cavity);
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
        if (pat === 'scale') {
          const c = v.noise.voronoi(v.p[0] * 70, v.p[1] * 70, v.p[2] * 70);
          const line = smoothstep(0.1, 0.0, c.f2 - c.f1);
          v.color = mixRgb(v.color, mixRgb(goldCol, v.color, 0.45), line * m * 0.85);
        } else if (pat === 'cloud') {
          const n = v.noise.fbm(v.p[0] * 22, v.p[1] * 22, v.p[2] * 22, { octaves: 2 });
          const line = smoothstep(0.035, 0.0, Math.abs(n));
          v.color = mixRgb(v.color, goldCol, line * m * 0.8);
        } else if (pat === 'wave') {
          const wv = Math.sin(v.p[1] * 190 + 5 * v.noise.fbm(v.p[0] * 14, v.p[1] * 6, v.p[2] * 14, { octaves: 2 }));
          const line = smoothstep(0.82, 0.96, wv);
          v.color = mixRgb(v.color, goldCol, line * m * 0.7);
        }
      }));
      break;
    }
    case 'gold':
    case 'metal': {
      L.push(strands({ flow: () => [0, 1, 0.3], freq: 200, stretch: 8, amount: 0.08, octaves: 2, mask }));
      L.push(custom(`${tag}:gold`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        const k = 0.86 + 0.28 * (v.n[1] * 0.5 + 0.5) + 0.3 * Math.max(0, v.cavity) - 0.15 * Math.max(0, -v.cavity);
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'fur': {
      L.push(strands({ flow: () => [0, -1, -0.25], freq: 110, stretch: 6, amount: 0.22, octaves: 2, mask }));
      L.push(strands({ flow: () => [0, -1, -0.25], freq: 330, stretch: 9, amount: 0.34, octaves: 2, tint: adjust(base, 0.12, 0.7), mask: (v) => 0.5 * mask(v) }));
      L.push(furClumps({ freq: 34, amount: 0.18, stretch: [1, 0.7, 1] }));
      L.push(custom(`${tag}:furtip`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        const k = 1 - 0.3 * smoothstep(0.0, 0.7, v.ao) * 0 + 0.1 * v.noise.noise(v.p[0] * 90, v.p[1] * 90, v.p[2] * 90) * m;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'hair': {
      const hl = rgb(p.hair.highlight ?? p.hair.color);
      L.push(strands({ flow: () => [0, -1, -0.2], freq: 160, stretch: 12, amount: 0.3, octaves: 2, mask }));
      L.push(strands({ flow: () => [0, -1, -0.2], freq: 420, stretch: 14, amount: 0.9, octaves: 1, tint: hl, mask: (v) => 0.35 * mask(v) * smoothstep(-0.2, 0.6, v.n[1] + 0.3) }));
      break;
    }
    case 'bone':
    case 'horn': {
      L.push(custom(`${tag}:bone`, (v) => {
        const m = mask(v);
        if (m <= 0) return;
        const g = v.noise.fbm(v.p[0] * 30, v.p[1] * 160, v.p[2] * 30, { octaves: 2 });
        const k = 1 + 0.12 * g * m;
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      }));
      break;
    }
    case 'rune':
    case 'ink': {
      break;
    }
    default:
      break;
  }
  // trim (gold / contrast edge) painted after the piece
  const trimKey = String(pc.o.trim ?? (fam === 'cloth' || fam === 'sash' || fam === 'leather' ? (p.palette.trim ? 'trim' : 'gold') : fam === 'paper' ? 'ink' : 'gold'));
  if (pc.o.trim !== 'none') {
    const tc = pal(trimKey, '#d4a640');
    const tm = (v: PaintVertex): number => R(v, `t${pc.i}`, 0.0035);
    L.push(layer(`${tag}:trim`, tc, tm));
    if (family(trimKey) === 'gold') {
      L.push(custom(`${tag}:trimShine`, (v) => {
        const m = tm(v);
        if (m <= 0) return;
        const k = 0.9 + 0.25 * (v.n[1] * 0.5 + 0.5);
        v.color = mixRgb(v.color, [v.color[0] * k, v.color[1] * k, v.color[2] * k], m);
      }));
    }
  }
  void vnorm;
  return L;
}
