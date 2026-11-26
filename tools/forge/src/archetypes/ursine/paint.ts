// Ursine paint: grizzled coat (dark undercoat, golden guard-hair tips, dark stockings, tan muzzle) built from FUR STROKES, i.e. voronoi
// clumps stretched along the fur direction (back along the body, down the legs) that are dark at the root and light at the tip, plus fine
// strands. Everything is baked per texel into the albedo; AO / cavity / hemisphere / rim are the per-vertex shade multiplier (COLOR_0).
// Zoning uses skin-weight bone masks (free) instead of SDF region queries (expensive); regions are only used for small face/paw features.
// The base stays light/mid: the game multiplies roster tints (down to #4a4a54) into it.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, gradient, grain, hemi, layer, region, rimTint } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';

const mul = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const LR = (names: string[]): string[] => names.flatMap((n) => [`${n}_l`, `${n}_r`]);
const UPPER = [...LR(['arm']), ...LR(['thigh'])];
const LOWER = [...LR(['forearm']), ...LR(['hand']), ...LR(['shin']), ...LR(['foot']), ...LR(['toe'])];
const HEAD = ['head', 'jaw', ...LR(['ear'])];

export function makePaint(a: Anatomy, textureSize = 1024): PaintSpec {
  const p = a.p;
  const pal = p.palette;
  const s = a.s;
  const belly = 0.5 * s;
  const top = a.humpTop;

  // region masks are SDF queries: memoise them per texel so the layers below share one evaluation
  let cv: PaintVertex | null = null;
  const cache = new Map<string, number>();
  const reg = (v: PaintVertex, tag: string, soft = 0.02): number => {
    if (v !== cv) {
      cv = v;
      cache.clear();
    }
    const k = `${tag}:${soft}`;
    let m = cache.get(k);
    if (m === undefined) cache.set(k, (m = v.region(tag, soft)));
    return m;
  };
  const W = (v: PaintVertex, names: string[]): number => {
    let w = 0;
    for (const n of names) w += v.bone(n);
    return clamp01(w);
  };
  const lowerW = (v: PaintVertex): number => smoothstep(0.25, 0.8, W(v, LOWER));
  const upperW = (v: PaintVertex): number => smoothstep(0.25, 0.8, W(v, UPPER));
  const headW = (v: PaintVertex): number => smoothstep(0.25, 0.8, W(v, HEAD));
  const legW = (v: PaintVertex): number => clamp01(lowerW(v) + upperW(v) * 0.7);
  const bodyMask = (v: PaintVertex): number => 1 - Math.max(legW(v), headW(v) * 0.9);

  const out: PaintLayer[] = [fill(pal.flank)];

  // ---- coat zoning: shadowed undercoat belly -> flank -> golden-tipped cape over the hump and neck
  out.push(
    gradient([0, 1, 0], belly, top, [
      [0, mixRgb(pal.dark, pal.back, 0.5)],
      [0.28, pal.back],
      [0.55, mixRgb(pal.back, pal.flank, 0.6)],
      [0.78, pal.flank],
      [1, mixRgb(pal.flank, pal.tip, 0.5)],
    ], { warp: { freq: 5 / s, amp: 0.12 }, mask: bodyMask }),
  );
  // grizzled cape over the shoulders, neck and hump (patchy golden guard hair), darker saddle behind it
  const capeNoise = (v: PaintVertex): number => 0.5 + 0.5 * v.noise.fbm(v.p[0] * 6 / s, v.p[1] * 6 / s, v.p[2] * 4 / s, { octaves: 2 });
  out.push(layer('cape', pal.tip, (v) => bodyMask(v) * smoothstep(0.0, 0.6, v.n[1] + 0.2) * smoothstep(0.0, 0.3 * s, v.p[2] + 0.02 * s) * smoothstep(0.25, 0.7, capeNoise(v)) * 0.75));
  out.push(layer('saddle', pal.back, (v) => bodyMask(v) * smoothstep(0.3, 0.8, v.n[1]) * (1 - smoothstep(-0.05 * s, 0.14 * s, v.p[2])) * smoothstep(-0.78 * s, -0.5 * s, v.p[2]) * 0.6 * (1 - 0.5 * capeNoise(v))));
  out.push(layer('haunch', pal.light, (v) => bodyMask(v) * smoothstep(-0.5 * s, -0.7 * s, v.p[2]) * smoothstep(0.35, 0.05, v.n[1]) * smoothstep(0.55 * s, 0.9 * s, v.p[1]) * 0.28));

  // ---- limbs: dark stockings and paws, medium upper limbs, lighter inner arms
  out.push(layer('upperLimb', mixRgb(pal.flank, pal.dark, 0.5), (v) => upperW(v) * 0.7 * (1 - lowerW(v))));
  out.push(layer('stocking', pal.dark, (v) => lowerW(v) * 0.95));
  out.push(layer('innerLeg', pal.light, (v) => legW(v) * smoothstep(0.1, 0.85, v.n[0] * (v.p[0] > 0 ? -1 : 1)) * 0.25 * (1 - lowerW(v))));
  out.push(region('paw', mixRgb(pal.dark, [0.02, 0.012, 0.01], 0.35), 0.8, 0.012));
  out.push(region('toe', mixRgb(pal.dark, pal.flank, 0.15), 0.7, 0.006));
  out.push(region('claw', pal.claw, 1, 0.003));

  // ---- tail
  out.push(region('tail_tip', pal.dark, 0.6, 0.04));

  // ---- head: tan muzzle, dark mask around the eyes, dark ears, black nose leather
  out.push(region('muzzle', pal.muzzle, 0.95, 0.03));
  out.push(region('cheek', mixRgb(pal.flank, pal.muzzle, 0.45), 0.6, 0.04));
  out.push(layer('throat', mixRgb(pal.light, pal.muzzle, 0.4), (v) => reg(v, 'throat', 0.06) * smoothstep(0.1, -0.5, v.n[1]) * 0.55));
  out.push(layer('muzzleTop', pal.back, (v) => reg(v, 'muzzle', 0.03) * smoothstep(0.5, 0.95, v.n[1]) * 0.38 * (1 - reg(v, 'jaw', 0.02))));
  out.push(layer('eyeMask', pal.dark, (v) => reg(v, 'eye', 0.05) * 0.8));
  out.push(layer('brow', pal.dark, (v) => reg(v, 'brow', 0.014) * 0.5));
  out.push(region('ear', pal.dark, 0.9, 0.012));
  out.push(region('ear_inner', pal.inner, 0.95, 0.008));
  out.push(region('nose', pal.nose, 1, 0.006));
  out.push(region('nostril', [0, 0, 0], 1, 0.004));
  out.push(region('lipline', mixRgb(pal.mouth, [0.02, 0.01, 0.01], 0.65), 0.95, 0.007));
  out.push(region('tongue', pal.mouth, 1, 0.006));
  out.push(region('fang', [0.9, 0.86, 0.72], 1, 0.003));
  out.push(custom('eyes', (v) => {
    const ring = reg(v, 'eye', 0.016);
    if (ring > 0) v.color = mixRgb(v.color, mul(pal.dark, 0.5), 0.85 * ring);
    const e = reg(v, 'eye', 0.002);
    if (e > 0) v.color = mixRgb(v.color, pal.eye, e);
    const pu = reg(v, 'pupil', 0.0013);
    if (pu > 0) v.color = mixRgb(v.color, [0.012, 0.008, 0.008], pu);
  }));

  // ---- fur strokes: clumps stretched along the fur direction in a FIXED frame (z along the body, y down the legs), so the
  // strokes stay parallel instead of swirling. Dark root -> light tip inside each clump, faint creases between clumps.
  const detailMask = (v: PaintVertex): number => (1 - 0.7 * headW(v)) * (1 - reg(v, 'claw', 0.004)) * (1 - reg(v, 'nose', 0.006)) * (1 - reg(v, 'ear_inner', 0.01));
  const strokes = (o: { freq: number; stretch: number; amount: number; tipAmount: number; edge: number; tint?: Rgb; tintAmount?: number }): PaintLayer => ({
    name: 'strokes',
    apply(v) {
      const lw = legW(v);
      const m = detailMask(v);
      if (m <= 0.001) return;
      const f = o.freq / s;
      const eval1 = (leg: boolean): { k: number; tip: number; id: number } => {
        const w = leg
          ? v.noise.voronoi(v.p[0] * f, (v.p[1] * f) / o.stretch, v.p[2] * f, 0.95)
          : v.noise.voronoi(v.p[0] * f, v.p[1] * f, (v.p[2] * f) / o.stretch, 0.95);
        const q = leg ? (v.p[1] * f) / o.stretch - w.cy : (v.p[2] * f) / o.stretch - w.cz;
        const tip = smoothstep(-0.38, 0.38, -q) ; // tip = the end the hair points to (-z along the body, -y down the legs)
        const k = (w.id - 0.5) * 2 * o.amount + o.tipAmount * (tip - 0.4) - o.edge * (1 - smoothstep(0.02, 0.16, w.f2 - w.f1));
        return { k, tip, id: w.id };
      };
      const t = lw < 0.999 ? eval1(false) : null;
      const l = lw > 0.001 ? eval1(true) : null;
      const k = ((t?.k ?? 0) * (1 - lw) + (l?.k ?? 0) * lw) * m;
      let col: Rgb = v.color;
      if (o.tint) {
        const tipK = ((t ? t.tip * (0.35 + 0.65 * t.id) : 0) * (1 - lw) + (l ? l.tip * (0.35 + 0.65 * l.id) : 0) * lw) * (o.tintAmount ?? 0.4) * m;
        col = mixRgb(col, o.tint, clamp01(tipK * (0.5 + 0.5 * v.color[0] / Math.max(0.05, o.tint[0]))));
      }
      v.color = [col[0] * (1 + k), col[1] * (1 + k), col[2] * (1 + k)];
    },
  });
  out.push(strokes({ freq: 14, stretch: 3.4, amount: 0.24, tipAmount: 0.42, edge: 0.1, tint: pal.tip, tintAmount: 0.55 }));
  out.push(strokes({ freq: 36, stretch: 3.6, amount: 0.17, tipAmount: 0.3, edge: 0.07, tint: adjust(pal.tip, 0.04, 0.9), tintAmount: 0.3 }));
  // hair-level streaks: two octaves of directional noise
  out.push(custom('hair', (v) => {
    const lw = legW(v);
    const m = detailMask(v);
    const f = 140 / s;
    const nT = v.noise.fbm(v.p[0] * f, v.p[1] * f, (v.p[2] * f) / 9, { octaves: 2, gain: 0.55 });
    const nL = v.noise.fbm(v.p[0] * f, (v.p[1] * f) / 9, v.p[2] * f, { octaves: 2, gain: 0.55 });
    const n = nT * (1 - lw) + nL * lw;
    const k = n * 0.34 * m;
    let col: Rgb = v.color;
    if (n > 0.1) col = mixRgb(col, adjust(pal.tip, 0.02, 0.8), clamp01((n - 0.1) * 1.3 * m * 0.5 * smoothstep(-0.2, 0.6, v.n[1])));
    v.color = [col[0] * (1 + k), col[1] * (1 + k), col[2] * (1 + k)];
  }));
  // exposed fur-lock tips catch light
  out.push(layer('lockTip', pal.tip, (v) => smoothstep(0.62, 0.95, v.ao) * 0.18 * detailMask(v) * (1 - legW(v) * 0.5)));
  out.push(grain(0.05, 110 / s));

  const shade: PaintLayer[] = [
    cavity(0.32, 0.12),
    bakeAo(0.8, [0.44, 0.38, 0.38]),
    hemi(rgb('#fff4e0'), rgb('#a8957c'), 0.55),
    rimTint(rgb('#ffe3b8'), { strength: 0.1 }),
  ];
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
