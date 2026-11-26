// UiFx (C9): screen-space light effects for the UI, shared by every screen and modal.
//
//   <GodRays tone="gold" />        turning god-rays behind a modal / title: a procedural polar ray sprite (24-40 seeded rays
//                                  of varying width, length and strength, gaussian edges, radial falloff, hot core) drawn
//                                  ONCE per seed into a cached canvas, tinted per instance, composited with screen blend
//                                  and turned by a compositor-only CSS animation (no per-frame JS). Two counter-turning
//                                  layers give the slow interference shimmer.
//   <Motes preset="ember" />       one canvas, <= 128 pooled particles whose state is an analytic function of (seed, t):
//                                  ember | gold | snow | burst. Paused while hidden / off-screen, a single still frame under
//                                  prefers-reduced-motion, and `t` freezes it at an exact time (deterministic QA frames).
//   <Burst play={n} />             our recreation of the level-up read (light pillar of cool-white + gold streaks, ground
//                                  star flare, expanding rings, rising sparkles, flash). Shared by Level-up, Essence,
//                                  Chest and the run-end talent flash. `t` freezes every part at time t.
//   <Pillar /> / .ms-pillar        the streak light column on its own.
//   fx.css                         .ms-shine-sweep (title / plate shine), .ms-stamp, .ms-flash, .ms-flash-on,
//                                  .ms-ring-burst, .ms-pillar, .ms-norays (drops the legacy CSS conic ray layer of a modal).
//

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

// ------------------------------------------------------------------------------------------------------------ basics

const HAS_DOM = typeof document !== 'undefined';

/** Small deterministic PRNG (mulberry32). */
export function fxRng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prefersReducedMotion(): boolean {
  return HAS_DOM && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [255, 200, 110];
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number): string => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// ------------------------------------------------------------------------------------------------------- palettes

export type FxTone = 'gold' | 'legendary' | 'ember' | 'crimson' | 'jade' | 'frost' | 'violet' | 'pale';

interface Palette {
  /** white-hot core */
  hot: string;
  /** main light colour */
  main: string;
  /** outer, deeper colour of the same light */
  deep: string;
  /** secondary streak colour (the cool-white pillar streaks) */
  cool: string;
}

const PALETTES: Record<FxTone, Palette> = {
  gold: { hot: '#fff7e0', main: '#ffc65a', deep: '#d0761c', cool: '#8fe6ff' },
  legendary: { hot: '#fff0cc', main: '#ff9a34', deep: '#c8431a', cool: '#ffe0a0' },
  ember: { hot: '#fff1d4', main: '#ff8a3a', deep: '#a8341a', cool: '#ffd8a8' },
  crimson: { hot: '#ffe8dc', main: '#ff5a46', deep: '#8e1410', cool: '#ffc0a8' },
  jade: { hot: '#f0fff4', main: '#7fe3aa', deep: '#1f7a52', cool: '#d8fff0' },
  frost: { hot: '#f4fcff', main: '#8fdcff', deep: '#2a6ab8', cool: '#e6fbff' },
  violet: { hot: '#f8f0ff', main: '#bb8cff', deep: '#5a2aa8', cool: '#efe2ff' },
  pale: { hot: '#ffffff', main: '#fff1cf', deep: '#b89a62', cool: '#eef8ff' },
};

/** Palette for a tone, or a custom light colour (`color` wins over `tone`). */
export function fxPalette(tone: FxTone = 'gold', color?: string): Palette {
  const base = PALETTES[tone] ?? PALETTES.gold;
  if (!color) return base;
  const [r, g, b] = hexRgb(color);
  const mix = (t: number, k: number): string => `#${[r, g, b].map((c) => Math.round(c + (t - c) * k).toString(16).padStart(2, '0')).join('')}`;
  return { hot: mix(255, 0.82), main: color, deep: mix(0, 0.45), cool: mix(255, 0.6) };
}

// ------------------------------------------------------------------------------------------------- polar sprites
// White light with alpha, generated per pixel in polar space: I(θ, r) = Σ_k A_k(θ) · F_k(r) + core(r), where A_k is the
// angular profile of ray class k (sum of gaussians, one per ray) and F_k its radial falloff. Three length classes keep
// it separable, so a 640² sprite costs ~10-20 ms once per (kind, seed) and is cached for the session.

interface PolarSpec {
  seed: number;
  rays: number;
  /** angular half-width range of a ray, degrees */
  width: [number, number];
  /** strength range */
  power: [number, number];
  /** ray length (fraction of the radius) per class: short / mid / long */
  lengths: [number, number, number];
  /** fine filament rays per main ray */
  fine: number;
  /** core glow strength / radius (fraction of the radius) */
  core: number;
  coreR: number;
  /** soft halo under the rays */
  halo: number;
  size: number;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function polarSprite(spec: PolarSpec): HTMLCanvasElement {
  const key = JSON.stringify(spec);
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const S = spec.size;
  const BINS = 2048;
  const rng = fxRng(spec.seed);
  // angular profiles per length class (0 short, 1 mid, 2 long)
  const prof = [new Float32Array(BINS), new Float32Array(BINS), new Float32Array(BINS)];
  const addRay = (cls: number, center: number, halfDeg: number, power: number): void => {
    const p = prof[cls];
    if (!p) return;
    const sigma = ((halfDeg * Math.PI) / 180) * 0.62;
    const span = Math.ceil(((sigma * 3.2) / (Math.PI * 2)) * BINS);
    const c = (center / (Math.PI * 2)) * BINS;
    for (let k = -span; k <= span; k++) {
      const bin = (((Math.round(c) + k) % BINS) + BINS) % BINS;
      const d = ((Math.round(c) + k - c) / BINS) * Math.PI * 2;
      p[bin] = (p[bin] ?? 0) + power * Math.exp(-(d * d) / (2 * sigma * sigma));
    }
  };
  for (let i = 0; i < spec.rays; i++) {
    const center = ((i + (rng() - 0.5) * 0.75) / spec.rays) * Math.PI * 2;
    const u = rng();
    const half = spec.width[0] + (spec.width[1] - spec.width[0]) * u * u;
    const power = spec.power[0] + (spec.power[1] - spec.power[0]) * rng();
    // alternate long / short like real shafts of light, with some randomness
    const cls = i % 2 === 0 ? (rng() < 0.75 ? 2 : 1) : rng() < 0.6 ? 0 : 1;
    addRay(cls, center, half, power);
    for (let f = 0; f < spec.fine; f++) {
      addRay(rng() < 0.5 ? 0 : 1, center + (rng() - 0.5) * ((Math.PI * 2) / spec.rays) * 1.6, half * (0.18 + rng() * 0.22), power * (0.22 + rng() * 0.3));
    }
  }
  // radial falloffs: bright near the core, fading out with a soft tail
  const R = S / 2;
  const RB = 512;
  const fall = spec.lengths.map((len) => {
    const f = new Float32Array(RB);
    for (let j = 0; j < RB; j++) {
      const r = j / (RB - 1);
      const inner = smooth(0.012, 0.09, r); // rays emerge from the core, not from a point
      const outer = Math.pow(clamp01(1 - r / len), 1.65);
      f[j] = inner * outer * (0.75 + 0.25 * Math.exp(-r * 3));
    }
    return f;
  });
  const img = new ImageData(S, S);
  const data = img.data;
  const coreR2 = spec.coreR * spec.coreR;
  for (let y = 0; y < S; y++) {
    const dy = (y + 0.5 - R) / R;
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - R) / R;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= 1) continue;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI * 2;
      const bin = Math.min(BINS - 1, Math.floor((a / (Math.PI * 2)) * BINS));
      const rj = Math.min(RB - 1, Math.floor(r * (RB - 1)));
      let v = 0;
      for (let c = 0; c < 3; c++) v += (prof[c]?.[bin] ?? 0) * (fall[c]?.[rj] ?? 0);
      v += spec.core * Math.exp(-(r * r) / coreR2) + spec.halo * Math.exp(-(r * r) / 0.09) * (1 - r);
      const edge = smooth(1, 0.82, r); // nothing reaches the sprite border
      const alpha = 1 - Math.exp(-v * 1.35); // soft-clip highlights instead of hard saturation
      const o = (y * S + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(clamp01(alpha * edge) * 255);
    }
  }
  const c = canvas(S, S);
  c.getContext('2d')?.putImageData(img, 0, 0);
  spriteCache.set(key, c);
  return c;
}

/** Tints a white alpha sprite into `dst` with a radial colour ramp (hot core -> main -> deep). */
function tintInto(dst: HTMLCanvasElement, sprite: HTMLCanvasElement, pal: Palette, strength = 1): void {
  const ctx = dst.getContext('2d');
  if (!ctx) return;
  const S = dst.width;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, S, dst.height);
  ctx.globalAlpha = Math.min(1, strength);
  ctx.drawImage(sprite, 0, 0, S, dst.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-in';
  const g = ctx.createRadialGradient(S / 2, dst.height / 2, 0, S / 2, dst.height / 2, S / 2);
  g.addColorStop(0, pal.hot);
  g.addColorStop(0.1, pal.hot);
  g.addColorStop(0.24, pal.main);
  g.addColorStop(0.62, pal.main);
  g.addColorStop(1, pal.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, dst.height);
  ctx.globalCompositeOperation = 'source-over';
}

const RAY_SIZE = 640;

function raySpec(seed: number, rays: number, layer: 0 | 1): PolarSpec {
  return layer === 0
    ? { seed, rays, width: [0.7, 3.1], power: [0.35, 1], lengths: [0.46, 0.7, 0.98], fine: 2, core: 0.9, coreR: 0.075, halo: 0.22, size: RAY_SIZE }
    : { seed: seed + 1013, rays: Math.max(12, Math.round(rays * 0.55)), width: [2.2, 5.5], power: [0.18, 0.5], lengths: [0.5, 0.75, 0.95], fine: 0, core: 0.35, coreR: 0.12, halo: 0.12, size: RAY_SIZE };
}

// ------------------------------------------------------------------------------------------------ thorn crown (ground)
// The ground flare of the level-up read: a bright thin ring with 72 sharp tapered thorns thrown outward (irregular
// lengths, a few long ones), a dim glowing disc inside. White alpha sprite like the ray sprites; tinted per palette
// (hot ring -> main -> deep thorn tips) and lies flat on the ground in the burst (scaleY ~ .5). Each pixel only looks at
// the 3 nearest thorns, so a 512² sprite costs ~15 ms once per seed.

function thornSprite(seed: number, S = 512): HTMLCanvasElement {
  const key = `thorn|${seed}|${S}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const rng = fxRng(seed + 211);
  const N = 72;
  const STEP = (Math.PI * 2) / N;
  const spikes: { a: number; len: number; w: number; p: number }[] = [];
  for (let i = 0; i < N; i++) {
    const long = rng() < 0.26;
    spikes.push({ a: (i + (rng() - 0.5) * 0.5) * STEP, len: long ? 0.32 + rng() * 0.14 : 0.13 + rng() * 0.17, w: STEP * (0.28 + rng() * 0.22), p: 0.7 + rng() * 0.3 });
  }
  const R = S / 2;
  const r0 = 0.5;
  const img = new ImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const dy = (y + 0.5 - R) / R;
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - R) / R;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= 1) continue;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI * 2;
      const dr = r - r0;
      // ring + its glow, inside disc (dim, brightest next to the ring)
      let v = Math.exp(-(dr * dr) / (2 * 0.011 * 0.011)) * 1.1 + Math.exp(-(dr * dr) / (2 * 0.05 * 0.05)) * 0.34;
      if (dr < 0) v += 0.2 * Math.pow(smooth(0, r0, r), 2.4) * (0.7 + 0.3 * Math.sin(a * 9));
      const base = Math.floor(a / STEP);
      for (let k = -1; k <= 1; k++) {
        const s = spikes[(((base + k) % N) + N) % N];
        if (!s) continue;
        const t = (r - (r0 - 0.02)) / s.len;
        if (t < 0 || t >= 1) continue;
        let da = a - s.a;
        da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
        const hw = s.w * Math.pow(1 - t, 1.15) + 0.0025;
        const u = da / hw;
        if (u > 3 || u < -3) continue;
        v += s.p * Math.exp(-u * u * 1.5) * Math.pow(1 - t, 0.8) * (0.55 + 0.45 * smooth(0, 0.14, t));
      }
      const o = (y * S + x) * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = Math.round(clamp01((1 - Math.exp(-v * 1.5)) * smooth(1, 0.94, r)) * 255);
    }
  }
  const c = canvas(S, S);
  c.getContext('2d')?.putImageData(img, 0, 0);
  spriteCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------------------------------------- streak column
// Vertical light streaks for the pillar: gaussian streaks in x (two colours: cool-white + palette gold), each modulated
// along y by smooth seeded noise, with a hot centre band. The texture is 2x taller than the column and scrolls upward.

const streakCache = new Map<string, HTMLCanvasElement>();

function streakTexture(seed: number, pal: Palette): HTMLCanvasElement {
  const key = `${seed}|${pal.cool}|${pal.main}|${pal.hot}`;
  const hit = streakCache.get(key);
  if (hit) return hit;
  const W = 256;
  const H = 640;
  const rng = fxRng(seed);
  const cool = hexRgb(pal.cool);
  const warm = hexRgb(pal.main);
  const hot = hexRgb(pal.hot);
  interface Streak {
    x: number;
    w: number;
    a: number;
    warm: number;
    ph: number[];
    fq: number[];
  }
  const streaks: Streak[] = [];
  const n = 52;
  for (let i = 0; i < n; i++) {
    const u = rng();
    // denser towards the centre of the column, never touching the border
    const x = 0.5 + (rng() - 0.5) * (0.34 + 0.62 * u);
    const thin = rng() < 0.62;
    streaks.push({ x, w: thin ? 0.0035 + rng() * 0.008 : 0.014 + rng() * rng() * 0.05, a: thin ? 0.35 + rng() * 0.65 : 0.18 + rng() * 0.4, warm: rng() < 0.4 ? 1 : 0, ph: [rng() * 6.28, rng() * 6.28, rng() * 6.28], fq: [1 + Math.floor(rng() * 3), 3 + Math.floor(rng() * 4), 7 + Math.floor(rng() * 6)] });
  }
  const img = new ImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const v = y / H; // periodic in v so the scroll wraps seamlessly
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const win = smooth(0.02, 0.24, u) * smooth(0.98, 0.76, u); // soft cylinder edges, no hard column border
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const s of streaks) {
        const dx = (u - s.x) / s.w;
        if (dx > 3.2 || dx < -3.2) continue;
        const along = 0.55 + 0.25 * Math.sin(v * 6.283 * (s.fq[0] ?? 1) + (s.ph[0] ?? 0)) + 0.15 * Math.sin(v * 6.283 * (s.fq[1] ?? 3) + (s.ph[1] ?? 0)) + 0.08 * Math.sin(v * 6.283 * (s.fq[2] ?? 7) + (s.ph[2] ?? 0));
        const k = s.a * Math.exp(-0.5 * dx * dx) * clamp01(along) * win;
        const c = s.warm ? warm : cool;
        r += c[0] * k;
        g += c[1] * k;
        b += c[2] * k;
        a += k;
      }
      // hot central band (the bright core of the column)
      const cb = Math.exp(-Math.pow((u - 0.5) / 0.085, 2)) * 0.5 * (0.8 + 0.2 * Math.sin(v * 6.283 * 3));
      r += hot[0] * cb;
      g += hot[1] * cb;
      b += hot[2] * cb;
      a += cb;
      // soft side glow (the lit volume between the streaks)
      const glow = Math.exp(-Math.pow((u - 0.5) / 0.26, 2)) * 0.2;
      r += cool[0] * glow * 0.6 + warm[0] * glow * 0.4;
      g += cool[1] * glow * 0.6 + warm[1] * glow * 0.4;
      b += cool[2] * glow * 0.6 + warm[2] * glow * 0.4;
      a += glow;
      const o = (y * W + x) * 4;
      const al = 1 - Math.exp(-a * 1.25);
      const inv = a > 0 ? 1 / a : 0;
      d[o] = Math.min(255, r * inv);
      d[o + 1] = Math.min(255, g * inv);
      d[o + 2] = Math.min(255, b * inv);
      d[o + 3] = Math.round(clamp01(al) * 255);
    }
  }
  const c = canvas(W, H);
  c.getContext('2d')?.putImageData(img, 0, 0);
  streakCache.set(key, c);
  return c;
}

function copyInto(dst: HTMLCanvasElement | null, src: HTMLCanvasElement): void {
  if (!dst) return;
  const ctx = dst.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
}

// ------------------------------------------------------------------------------------------------------- GodRays

export interface GodRaysProps {
  /** light colour preset (default gold) */
  tone?: FxTone;
  /** explicit light colour (#rrggbb), wins over `tone` */
  color?: string;
  /** main ray count, 24-40 (default 32) */
  rays?: number;
  /** ray layout seed (default 7) */
  seed?: number;
  /** centre inside the host box (CSS lengths / percentages; default 50% 46%) */
  x?: string;
  y?: string;
  /** diameter of the ray disc (default 125vmax) */
  size?: string;
  /** opacity multiplier 0..1.5 (default 1) */
  intensity?: number;
  /** seconds per turn of the main layer; 0 = still (default 150) */
  spin?: number;
  /** slow breathing of the whole layer (default true) */
  pulse?: boolean;
  class?: string;
}

/**
 * Turning god-rays. Absolutely fills its positioned parent and clips itself (never adds scroll); place it as the first
 * child so the content paints above it.
 */
export function GodRays({ tone = 'gold', color, rays = 32, seed = 7, x = '50%', y = '46%', size = '125vmax', intensity = 1, spin = 150, pulse = true, class: cls = '' }: GodRaysProps): JSX.Element {
  const a = useRef<HTMLCanvasElement>(null);
  const b = useRef<HTMLCanvasElement>(null);
  const n = Math.max(24, Math.min(40, Math.round(rays)));
  const pal = fxPalette(tone, color);
  useLayoutEffect(() => {
    if (a.current) tintInto(a.current, polarSprite(raySpec(seed, n, 0)), pal);
    if (b.current) tintInto(b.current, polarSprite(raySpec(seed, n, 1)), pal);
  }, [seed, n, pal.hot, pal.main, pal.deep]);
  const style = { '--gr-x': x, '--gr-y': y, '--gr-size': size, '--gr-i': String(intensity), '--gr-spin': `${spin > 0 ? spin : 1}s` } as JSX.CSSProperties;
  return (
    <div class={`ms-godrays${pulse ? ' is-pulse' : ''}${spin > 0 ? '' : ' is-still'} ${cls}`} style={style} aria-hidden="true">
      <canvas ref={a} class="ms-godrays-a" width={RAY_SIZE} height={RAY_SIZE} />
      <canvas ref={b} class="ms-godrays-b" width={RAY_SIZE} height={RAY_SIZE} />
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------- Motes

export type MotesPreset = 'ember' | 'gold' | 'snow' | 'burst';

export interface MotesProps {
  /** ember (rising sparks) | gold (floating dust + twinkles) | snow (falling flakes) | burst (one-shot spray) */
  preset?: MotesPreset;
  /** particle count, clamped to 128 (default by preset) */
  count?: number;
  /** light colour override (#rrggbb) */
  color?: string;
  /** legacy alias of the Essence motes API: rise = ember / gold by colour, burst = burst */
  mode?: 'rise' | 'burst';
  seed?: number;
  /** burst origin, fractions of the box (default .5 / .46) */
  x?: number;
  y?: number;
  /** burst radius multiplier (default 1) */
  spread?: number;
  /** time scale (default 1) */
  speed?: number;
  /** alpha multiplier (default 1) */
  intensity?: number;
  /** burst: seconds before it fires */
  delay?: number;
  /** burst: fire again every `period` seconds */
  loop?: boolean;
  period?: number;
  /** freeze at time t (seconds since mount) — deterministic frames for QA; no animation loop */
  t?: number;
  class?: string;
}

const MAX_MOTES = 128;

interface Mote {
  /** kind: 0 glow dot, 1 star twinkle, 2 streak */
  k: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  drag: number;
  g: number;
  size: number;
  alpha: number;
  life: number;
  phase: number;
  wobA: number;
  wobF: number;
  wobP: number;
  flkF: number;
  flkP: number;
  delay: number;
  hot: number;
}

const DEFAULT_COUNT: Record<MotesPreset, number> = { ember: 28, gold: 36, snow: 60, burst: 56 };

function buildMotes(preset: MotesPreset, count: number, seed: number): Mote[] {
  const rng = fxRng(seed * 7919 + preset.length * 131);
  const out: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const u = rng();
    const m: Mote = { k: 0, x0: rng(), y0: 0, vx: 0, vy: 0, drag: 0, g: 0, size: 1, alpha: 1, life: 1, phase: rng(), wobA: 0, wobF: 0, wobP: rng() * 6.283, flkF: 0, flkP: rng() * 6.283, delay: 0, hot: rng() };
    if (preset === 'ember') {
      const bokeh = u < 0.1;
      m.vy = 0.045 + rng() * 0.07; // fraction of the height per second
      m.vx = (rng() - 0.38) * 0.12; // drift over one rise
      m.size = bokeh ? 6 + rng() * 5 : 1.3 + Math.pow(rng(), 1.8) * 3.2;
      m.alpha = bokeh ? 0.16 + rng() * 0.14 : 0.45 + rng() * 0.55;
      m.wobA = 0.004 + rng() * 0.016;
      m.wobF = 0.15 + rng() * 0.35;
      m.flkF = 1.5 + rng() * 3;
      m.k = bokeh ? 3 : 0;
    } else if (preset === 'gold') {
      const star = u < 0.34;
      m.vy = 0.012 + rng() * 0.03;
      m.vx = (rng() - 0.5) * 0.08;
      m.size = star ? 4 + rng() * 5 : 1 + Math.pow(rng(), 1.6) * 2.6;
      m.alpha = star ? 0.7 + rng() * 0.3 : 0.3 + rng() * 0.5;
      m.wobA = 0.006 + rng() * 0.02;
      m.wobF = 0.08 + rng() * 0.2;
      m.flkF = star ? 0.25 + rng() * 0.45 : 0.6 + rng() * 1.4;
      m.k = star ? 1 : 0;
    } else if (preset === 'snow') {
      const bokeh = u < 0.08;
      const s = Math.pow(rng(), 1.5);
      m.size = bokeh ? 7 + rng() * 6 : 1.3 + s * 3.6;
      m.vy = bokeh ? 0.025 + rng() * 0.02 : 0.035 + s * 0.07; // bigger flakes fall faster (closer)
      m.vx = (rng() - 0.5) * 0.06;
      m.alpha = bokeh ? 0.12 + rng() * 0.1 : 0.45 + rng() * 0.45;
      m.wobA = 0.01 + rng() * 0.03;
      m.wobF = 0.08 + rng() * 0.25;
      m.k = bokeh ? 3 : 0;
    } else {
      // burst: 55 % sparks thrown out (upward bias), 25 % rising streaks, 20 % slow dust ring
      m.delay = rng() * 0.12;
      if (u < 0.55) {
        const up = rng() < 0.62;
        const ang = up ? -Math.PI / 2 + (rng() - 0.5) * 2.4 : rng() * Math.PI * 2;
        const sp = 0.55 + rng() * 0.8;
        m.vx = Math.cos(ang) * sp;
        m.vy = Math.sin(ang) * sp;
        m.drag = 2.1 + rng() * 1.4;
        m.g = 0.06 + rng() * 0.2;
        m.life = 0.75 + rng() * 0.9;
        m.size = 2 + rng() * 3.4;
        m.k = rng() < 0.42 ? 1 : 0;
        m.alpha = 0.75 + rng() * 0.25;
      } else if (u < 0.8) {
        m.x0 = (rng() - 0.5) * 0.55;
        m.y0 = (rng() - 0.35) * 0.18;
        m.vx = (rng() - 0.5) * 0.05;
        m.vy = -(0.35 + rng() * 0.65);
        m.life = 0.9 + rng() * 0.9;
        m.size = 1.6 + rng() * 2;
        m.k = 2;
        m.alpha = 0.55 + rng() * 0.45;
        m.delay = 0.05 + rng() * 0.3;
        m.wobA = 0.01 + rng() * 0.02;
        m.wobF = 0.6 + rng() * 0.8;
      } else {
        const ang = rng() * Math.PI * 2;
        const sp = 0.25 + rng() * 0.3;
        m.vx = Math.cos(ang) * sp;
        m.vy = Math.sin(ang) * sp * 0.5;
        m.drag = 3 + rng() * 2;
        m.g = -0.03;
        m.life = 1.2 + rng() * 0.9;
        m.size = 1.2 + rng() * 1.8;
        m.alpha = 0.35 + rng() * 0.35;
        m.k = 0;
      }
    }
    out.push(m);
  }
  return out;
}

// sprites (64 px), cached per colour
const moteSprites = new Map<string, HTMLCanvasElement>();
function moteSprite(kind: number, pal: Palette, snow: boolean): HTMLCanvasElement {
  const key = `${kind}|${snow ? 1 : 0}|${pal.hot}|${pal.main}|${pal.deep}`;
  const hit = moteSprites.get(key);
  if (hit) return hit;
  const S = 64;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  if (ctx) {
    const h = S / 2;
    if (snow) {
      const g = ctx.createRadialGradient(h, h, 0, h, h, h);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(kind === 3 ? 0.35 : 0.3, 'rgba(236,246,255,0.85)');
      g.addColorStop(kind === 3 ? 0.75 : 0.6, 'rgba(200,226,255,0.2)');
      g.addColorStop(1, 'rgba(200,226,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    } else if (kind === 1) {
      // four-point twinkle: long vertical + horizontal spikes, short diagonals, white core
      ctx.globalCompositeOperation = 'lighter';
      const spike = (rot: number, len: number, thick: number, a: number): void => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len / 2);
        g.addColorStop(0, rgba(pal.hot, a));
        g.addColorStop(0.3, rgba(pal.main, a * 0.62));
        g.addColorStop(1, rgba(pal.main, 0));
        ctx.save();
        ctx.translate(h, h);
        ctx.rotate(rot);
        ctx.scale(thick / len, 1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, len / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      spike(0, S, S * 0.075, 0.95);
      spike(Math.PI / 2, S, S * 0.075, 0.95);
      spike(Math.PI / 4, S * 0.55, S * 0.05, 0.55);
      spike(-Math.PI / 4, S * 0.55, S * 0.05, 0.55);
      const g = ctx.createRadialGradient(h, h, 0, h, h, S * 0.16);
      g.addColorStop(0, rgba(pal.hot, 1));
      g.addColorStop(1, rgba(pal.main, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    } else if (kind === 2) {
      // vertical streak (rising light mote): bright head on top, tail fading downward
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, rgba(pal.hot, 0));
      g.addColorStop(0.2, rgba(pal.hot, 0.95));
      g.addColorStop(0.55, rgba(pal.main, 0.55));
      g.addColorStop(1, rgba(pal.main, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(h, h, S * 0.06, h, 0, 0, Math.PI * 2);
      ctx.fill();
      const core = ctx.createRadialGradient(h, S * 0.24, 0, h, S * 0.24, S * 0.12);
      core.addColorStop(0, rgba(pal.hot, 1));
      core.addColorStop(1, rgba(pal.hot, 0));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, S, S);
    } else {
      // glow dot: white-hot core, coloured halo (kind 3 = soft out-of-focus disc)
      const g = ctx.createRadialGradient(h, h, 0, h, h, h);
      if (kind === 3) {
        g.addColorStop(0, rgba(pal.main, 0.55));
        g.addColorStop(0.55, rgba(pal.main, 0.35));
        g.addColorStop(0.8, rgba(pal.deep, 0.12));
        g.addColorStop(1, rgba(pal.deep, 0));
      } else {
        g.addColorStop(0, rgba(pal.hot, 1));
        g.addColorStop(0.13, rgba(pal.hot, 1));
        g.addColorStop(0.3, rgba(pal.main, 0.78));
        g.addColorStop(0.56, rgba(pal.deep, 0.22));
        g.addColorStop(1, rgba(pal.deep, 0));
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
  }
  moteSprites.set(key, c);
  return c;
}

/** Dev perf counters: window.__uifx.motes = { frames, avgMs, maxMs } (draw time of all Motes canvases). DEV only: a production page exposes no window.__uifx. */
interface FxStats {
  frames: number;
  avgMs: number;
  maxMs: number;
}
function stats(): FxStats | null {
  if (!import.meta.env.DEV || !HAS_DOM) return null;
  const w = window as unknown as { __uifx?: { motes: FxStats } };
  w.__uifx ??= { motes: { frames: 0, avgMs: 0, maxMs: 0 } };
  return w.__uifx.motes;
}

interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  k: number;
  preset: MotesPreset;
  motes: Mote[];
  sprites: HTMLCanvasElement[];
  ox: number;
  oy: number;
  spread: number;
  intensity: number;
}

/** Draws every mote at time t (seconds). Returns false once a one-shot burst is completely over. */
function drawMotes(d: DrawCtx, t: number): boolean {
  const { ctx, W, H, k, preset, motes, sprites } = d;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = preset === 'snow' ? 'source-over' : 'lighter';
  let alive = false;
  const R = Math.min(W, H) * 0.5 * d.spread;
  for (const m of motes) {
    let x: number;
    let y: number;
    let a: number;
    let s = m.size * k;
    let stretch = 1;
    if (preset === 'burst') {
      const tt = t - m.delay;
      if (tt < 0) {
        alive = true;
        continue;
      }
      if (tt > m.life) continue;
      alive = true;
      const life = tt / m.life;
      if (m.k === 2) {
        x = d.ox * W + m.x0 * R + m.vx * R * tt + Math.sin(tt * m.wobF * 6.283 + m.wobP) * m.wobA * R;
        y = d.oy * H + m.y0 * R + m.vy * R * tt;
        stretch = 2.2 + Math.abs(m.vy) * 2.2;
      } else {
        const e = m.drag > 0 ? (1 - Math.exp(-m.drag * tt)) / m.drag : tt;
        x = d.ox * W + m.vx * R * e;
        y = d.oy * H + m.vy * R * e + 0.5 * m.g * R * tt * tt;
      }
      a = m.alpha * Math.min(1, tt / 0.06) * Math.pow(1 - life, 1.5);
      s *= 1 - 0.45 * life;
      if (m.k === 1) a *= 0.65 + 0.35 * Math.sin(tt * 18 + m.flkP);
    } else if (preset === 'snow') {
      const T = 1.12 / m.vy;
      const p = (t / T + m.phase) % 1;
      y = (-0.06 + 1.12 * p) * H;
      x = (m.x0 + m.vx * p + Math.sin(t * m.wobF * 6.283 + m.wobP) * m.wobA) * W;
      a = m.alpha * smooth(0, 0.05, p) * smooth(1, 0.9, p);
      alive = true;
    } else {
      const T = 1.12 / m.vy;
      const p = (t / T + m.phase) % 1;
      y = (1.06 - 1.12 * p) * H;
      x = (m.x0 + m.vx * p + Math.sin(t * m.wobF * 6.283 + m.wobP) * m.wobA) * W;
      const top = preset === 'ember' ? smooth(0.02, 0.4, y / H) : smooth(0.0, 0.25, y / H) * smooth(1.04, 0.85, y / H);
      a = m.alpha * smooth(0, 0.06, p) * top;
      if (m.k === 1) a *= Math.pow(Math.max(0, Math.sin(t * m.flkF * 6.283 + m.flkP)), 3);
      else if (preset === 'ember') a *= 0.68 + 0.32 * Math.sin(t * m.flkF * 6.283 + m.flkP);
      else a *= 0.75 + 0.25 * Math.sin(t * m.flkF * 6.283 + m.flkP);
      alive = true;
    }
    a *= d.intensity;
    if (a <= 0.004) continue;
    const spr = sprites[m.k] ?? sprites[0];
    if (!spr) continue;
    const sz = s * 4; // the sprite's visible core is ~1/4 of its box
    ctx.globalAlpha = Math.min(1, a);
    if (m.k === 2) {
      ctx.drawImage(spr, x - sz * 0.5, y - sz * stretch * 0.24, sz, sz * stretch);
    } else {
      ctx.drawImage(spr, x - sz / 2, y - sz / 2, sz, sz);
      if (preset === 'ember' && m.k === 0) {
        // short motion trail below a rising ember
        const vyPx = (1.12 * H * m.vy) / 1.12;
        ctx.globalAlpha = Math.min(1, a * 0.42);
        ctx.drawImage(spr, x - sz * 0.4, y - sz * 0.4 + vyPx * 0.05, sz * 0.8, sz * 0.8);
        ctx.globalAlpha = Math.min(1, a * 0.2);
        ctx.drawImage(spr, x - sz * 0.3, y - sz * 0.3 + vyPx * 0.1, sz * 0.6, sz * 0.6);
      }
    }
  }
  ctx.globalAlpha = 1;
  return alive;
}

/**
 * Particle canvas. Fills its positioned parent (absolute, inset 0, never intercepts the pointer). Drop-in replacement for
 * the DOM <Motes> of the essence modal (count / color / mode / class keep their meaning).
 */
export function Motes({ preset, count, color, mode, seed = 1, x = 0.5, y = 0.46, spread = 1, speed = 1, intensity = 1, delay = 0, loop = false, period = 2.6, t, class: cls = '' }: MotesProps): JSX.Element {
  const kind: MotesPreset = preset ?? (mode === 'burst' ? 'burst' : 'ember');
  const n = Math.max(0, Math.min(MAX_MOTES, Math.round(count ?? DEFAULT_COUNT[kind])));
  const pal = kind === 'gold' && !color ? fxPalette('gold') : kind === 'snow' ? fxPalette('frost') : color ? fxPalette('gold', color) : fxPalette(kind === 'burst' ? 'gold' : 'ember');
  const host = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = host.current;
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!el || !c || !ctx) return;
    const motes = buildMotes(kind, n, seed);
    const snow = kind === 'snow';
    const sprites = [0, 1, 2, 3].map((kk) => moteSprite(kk, pal, snow));
    const reduced = prefersReducedMotion();
    let W = 1;
    let H = 1;
    let raf = 0;
    let visible = true;
    let running = false;
    const t0 = performance.now() / 1000;
    const st = stats();
    const dc: DrawCtx = { ctx, W, H, k: 1, preset: kind, motes, sprites, ox: x, oy: y, spread, intensity };
    const resize = (): void => {
      const r = el.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      let dpr = Math.min(2, window.devicePixelRatio || 1);
      if (W * H * dpr * dpr > 4.2e6) dpr = Math.max(1, Math.sqrt(4.2e6 / (W * H)));
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dc.W = W;
      dc.H = H;
      dc.k = Math.max(0.65, Math.min(1.6, Math.min(W, H) / 820));
    };
    const timeAt = (now: number): number => {
      const raw = (now / 1000 - t0) * speed - delay;
      if (kind === 'burst' && loop) return ((raw % period) + period) % period;
      return raw;
    };
    const paint = (time: number): boolean => {
      const a = performance.now();
      const alive = drawMotes(dc, time);
      if (st) {
        const ms = performance.now() - a;
        st.frames++;
        st.avgMs += (ms - st.avgMs) / Math.min(st.frames, 120);
        st.maxMs = Math.max(st.maxMs, ms);
      }
      return alive;
    };
    const frame = (now: number): void => {
      raf = 0;
      const alive = paint(timeAt(now));
      if (!alive && kind === 'burst' && !loop) {
        running = false;
        return;
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const start = (): void => {
      if (running || t !== undefined || reduced) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    resize();
    const still = (): void => {
      // fixed frame: QA time, or a representative still under reduced motion (a burst shows nothing then)
      if (t !== undefined) paint(t);
      else if (kind !== 'burst') paint(9.5);
      else ctx.clearRect(0, 0, W, H);
    };
    if (t !== undefined || reduced) still();
    else start();
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        resize();
        if (t !== undefined || reduced) still();
      });
    });
    ro.observe(el);
    const io = new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      if (visible) start();
    });
    io.observe(el);
    const onVis = (): void => {
      if (!document.hidden) start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (roRaf) cancelAnimationFrame(roRaf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [kind, n, seed, x, y, spread, speed, intensity, delay, loop, period, t, pal.hot, pal.main, pal.deep]);
  return (
    <div ref={host} class={`ms-fxmotes ms-fxmotes--${kind} ${cls}`} aria-hidden="true">
      <canvas ref={cv} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------- Pillar

export interface PillarProps {
  tone?: FxTone;
  color?: string;
  seed?: number;
  /** column centre x / foot y inside the host box (default 50% / 46%) */
  x?: string;
  y?: string;
  /** column width (default 15rem) */
  width?: string;
  class?: string;
}

/** Light column of cool-white + gold streaks from the top of the host down to (x, y); one-shot (`.ms-pillar`). */
export function Pillar({ tone = 'gold', color, seed = 5, x, y, width, class: cls = '' }: PillarProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const pal = fxPalette(tone, color);
  useLayoutEffect(() => copyInto(ref.current, streakTexture(seed, pal)), [seed, pal.cool, pal.main, pal.hot]);
  const style = { ...(x ? { '--fx-x': x } : {}), ...(y ? { '--fx-y': y } : {}), ...(width ? { '--pillar-w': width } : {}) } as JSX.CSSProperties;
  return (
    <i class={`ms-pillar ${cls}`} style={style} aria-hidden="true">
      <canvas ref={ref} width={256} height={640} />
    </i>
  );
}

// ----------------------------------------------------------------------------------------------------------- Burst

export interface BurstProps {
  /** change it (counter / key) to fire the burst again */
  play?: number | string;
  tone?: FxTone;
  color?: string;
  /** centre (the spot on the ground) inside the host box (percentages; default 50% / 46%) */
  x?: string;
  y?: string;
  /** size multiplier (default 1; ~0.6 for a card, 1 for a modal title) */
  scale?: number;
  pillar?: boolean;
  /** expanding shock ring on the ground */
  ring?: boolean;
  /** faint face-on halo ring over the pillar (default off) */
  halo?: boolean;
  /** ground flare: gold disc + thorn crown */
  star?: boolean;
  flash?: boolean;
  /** sparkle count (0 = none; default 56) */
  sparks?: number;
  seed?: number;
  /** freeze every part at time t (seconds) — QA frames */
  t?: number;
  class?: string;
}

const pctFrac = (v: string, d: number): number => {
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(v.trim());
  return m && m[1] ? Number(m[1]) / 100 : d;
};






export function Burst({ play, tone = 'gold', color, x = '50%', y = '46%', scale = 1, pillar = true, ring = true, halo = false, star = true, flash = true, sparks = 56, seed = 3, t, class: cls = '' }: BurstProps): JSX.Element {
  const pal = fxPalette(tone, color);
  const starRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (starRef.current) tintInto(starRef.current, thornSprite(seed), pal);
  }, [seed, pal.hot, pal.main, pal.deep, star, play]);
  const style = {
    '--fx-x': x,
    '--fx-y': y,
    '--fx-s': String(scale),
    '--fx-c': pal.main,
    '--fx-hot': pal.hot,
    '--fx-deep': pal.deep,
    '--bt': `${t ?? 0}s`,
  } as JSX.CSSProperties;
  return (
    <div key={play} class={`ms-burst${t !== undefined ? ' is-frozen' : ''} ${cls}`} style={style} aria-hidden="true">
      {flash && <i class="ms-flash" />}
      {star && <i class="ms-burst-ground" />}
      {pillar && <Pillar tone={tone} {...(color ? { color } : {})} seed={seed + 2} />}
      {star && <canvas ref={starRef} class="ms-burst-star" width={512} height={512} />}
      {ring && <i class="ms-ring-burst ms-ring-burst--ground" />}
      {halo && <i class="ms-ring-burst ms-ring-burst--halo" />}
      {sparks > 0 && <Motes key={`m${String(play)}`} preset="burst" count={sparks} seed={seed} x={pctFrac(x, 0.5)} y={pctFrac(y, 0.46)} spread={0.62 * scale} {...(color ? { color } : { color: pal.main })} {...(t !== undefined ? { t } : {})} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------- helpers

/** Props for a text element that should get the shine sweep: `<h1 {...shineProps(title)}>{title}</h1>`. */
export function shineProps(text: string, opts: { idle?: boolean; delay?: number } = {}): { class: string; 'data-text': string; style?: JSX.CSSProperties } {
  return {
    class: `ms-shine-sweep${opts.idle ? ' is-idle' : ''}`,
    'data-text': text,
    ...(opts.delay !== undefined ? { style: { '--shine-delay': `${opts.delay}s` } as JSX.CSSProperties } : {}),
  };
}

let warmed = false;

/**
 * Pre-computes the default ray / thorn / streak sprites in idle time (one idle task each, so no single long frame) and
 * the light-sprite canvases of the first modal opens without a hitch. Idempotent; EmberField calls it on mount.
 */
export function warmUiFx(): void {
  if (!HAS_DOM || warmed) return;
  warmed = true;
  const tasks: (() => void)[] = [() => polarSprite(raySpec(7, 32, 0)), () => polarSprite(raySpec(7, 32, 1)), () => thornSprite(3), () => streakTexture(5, fxPalette('gold')), () => streakTexture(7, fxPalette('gold'))];
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const next = (): void => {
    const task = tasks.shift();
    if (!task) return;
    const run = (): void => {
      task();
      next();
    };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
    else window.setTimeout(run, 400);
  };
  next();
}
