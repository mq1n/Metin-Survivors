// Damage numbers: ONE instanced quad batch (one glyph per instance) + a runtime glyph atlas, and one small batch for the
// crit starburst behind a critical number.
//

// bevel): the digits are drawn from the bundled Barlow Condensed 700 (OFL, ui/style/fonts.css), widened, sheared and
// fattened on a canvas at startup, so every host gets the same face. The fill is the whole look and there are only TWO

// element), red = damage we take. The element shows only as a faint hue in the near-black outline and, for crits, as a tint
// in the starburst. Mixed-case words (Miss / Block) are hollow: a coloured outer band, a black keyline, a pale body.
//
// Atlas (RGBA8 DataTexture, mipmapped), one mask per channel:
//   R = fill coverage (hollow words: the pale body)       G = outline silhouette (fill + crisp near-black stroke)
//   B = hollow words only: the outer coloured band        A = tight drop shadow (readability on snow / lava / telegraphs)
// The shader recolours only the fill per instance; the outline stays near-black.
//
// Structure: `DamageNumberField` is the pure simulation of the numbers (aggregation, caps, budget, ageing, spacing),
// `DamageNumbers` (RenderSystem) owns the atlas, the GPU batches and settings/quality plumbing.
import {
  AddEquation,
  BufferGeometry,
  CanvasTexture,
  CustomBlending,
  DataTexture,
  DoubleSide,
  DstColorFactor,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  ZeroFactor,
  type Texture,
} from 'three';
import type { Element } from '../../data/schema';
import { settings } from '../../engine/settings';
import { t } from '../../i18n/i18n';
import type { RenderCore, RenderSystem } from '../core';
import type { QualityProfile } from '../quality';

// ---------------------------------------------------------------------------------------------------------------
// Public types / colours

/** 'word' = a text bubble (Miss / Block): the text travels in `word`, the amount only counts merges */
export type DamageKind = 'normal' | 'heal' | 'player' | 'xp' | 'yeop' | 'status' | 'word';

export interface DamageSpawnOptions {
  crit?: boolean;
  /** `#rrggbb` fill colour (defaults by kind; crits keep their element colour) */
  color?: string;
  /** metres above the ground at (x,z); default 1.7 */
  height?: number;
  /** hits on the same target within the merge window are merged into one number */
  targetId?: number;
  kind?: DamageKind;
  /** text of a 'word' number; suffix of an 'xp' number (" XP") */
  word?: string;
  /** DMG-01: the player index who dealt a hit; a partner's hits (not `localPlayer`) never take the local hero's slots. Unset = the local hero. */
  player?: number;
}

export interface DamageNumbersOptions {
  /** CSS font-family list used for the glyph atlas; swap later with `setFont` */
  fontFamily?: string;
  /** append '!' to crit numbers (default false: a crit is told by its size, its hot rim and the starburst) */
  critSuffix?: boolean;
  /** cosmetic randomness (drift); defaults to Math.random */
  rng?: () => number;
}






export const DEALT_FILL = '#fff008';

export const TAKEN_FILL = '#ff1424';





const ELEMENT_COLORS: Record<Element, string> = {
  physical: DEALT_FILL,
  fire: '#ff6a1a',
  ice: '#3fb6ff',
  lightning: '#7f8cff',
  dark: '#b04cff',
  poison: '#7ddc2a',
  holy: '#ffe9a8',
  wind: '#3fe0c0',
};

/** Hue of an element (`#rrggbb`): the outline tint of its numbers and the tint of its crit starburst. */
export function elementColor(el: Element): string {
  return ELEMENT_COLORS[el] ?? ELEMENT_COLORS.physical;
}

/** The bundled face first (awaited with document.fonts.load before the atlas is built); the rest only if it is missing. */
export const DAMAGE_DEFAULT_FONT = '"Barlow Condensed", "Arial Narrow", "Arial Black", Impact, sans-serif';

const KIND_COLORS: Record<DamageKind, string> = {
  normal: DEALT_FILL,
  heal: '#3fd16e',
  player: TAKEN_FILL,
  xp: '#58a8ff',
  yeop: '#ffb21c',
  status: DEALT_FILL,
  word: TAKEN_FILL,
};

export const WORD_COLORS = { evade: '#ff2a1e', block: '#4f9dff' } as const;

/** damage we deal: a plain hit and a damage-over-time tick are filled with the one lemon yellow */
const isDealt = (kind: DamageKind): boolean => kind === 'normal' || kind === 'status';

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const easeOutCubic = (x: number): number => 1 - (1 - clamp(x, 0, 1)) ** 3;
const easeOutQuad = (x: number): number => 1 - (1 - clamp(x, 0, 1)) ** 2;
const smooth01 = (x: number): number => {
  const t01 = clamp(x, 0, 1);
  return t01 * t01 * (3 - 2 * t01);
};

/** Compact amount: "842", "9999", "12.3K", "123K", "1.2M", "4.5B". Never rounds below 1 for positive input. */
export function formatAmount(n: number): string {
  if (!(n > 0)) return '0';
  if (n < 10_000) return String(Math.max(1, Math.round(n)));
  const units: ReadonlyArray<readonly [number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (let i = 0; i < units.length; i++) {
    const [div, suf] = units[i] as readonly [number, string];
    if (n < div) continue;
    let v = n / div;
    let s = v < 100 ? v.toFixed(1) : String(Math.round(v));
    if (parseFloat(s) >= 1000 && i > 0) {
      const [d2, s2] = units[i - 1] as readonly [number, string];
      v = n / d2;
      s = v < 100 ? v.toFixed(1) : String(Math.round(v));
      return trimZero(s) + s2;
    }
    return trimZero(s) + suf;
  }
  return String(Math.round(n));
}
const trimZero = (s: string): string => (s.endsWith('.0') ? s.slice(0, -2) : s);

/**
 * Text of a number as drawn: '+' prefix for heal/xp/yeop, optional '!' on crits; an xp number carries its `word` ("+42 XP"),
 * a 'word' number is its mixed-case word ("Miss") written with the hollow-letter aliases of the atlas.
 */
export function damageText(amount: number, kind: DamageKind, crit: boolean, critSuffix: boolean, word?: string): string {
  if (kind === 'word') return Array.from(word ?? '', (c) => hollowAlias(c)).join('');
  const base = formatAmount(amount);
  const prefix = kind === 'heal' || kind === 'xp' || kind === 'yeop' ? '+' : '';
  const tail = kind === 'xp' && word ? ` ${word.toUpperCase()}` : '';
  return prefix + base + tail + (crit && critSuffix ? '!' : '');
}

/** `#rrggbb` → linear-light rgb (three's ColorManagement convention), cached per string. */
const hexCache = new Map<string, Float32Array>();
export function hexToLinear(hex: string, out?: Float32Array): Float32Array {
  let v = hexCache.get(hex);
  if (!v) {
    const h = hex.startsWith('#') ? hex.slice(1) : hex;
    const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
    const n = parseInt(full.slice(0, 6), 16);
    const c = Number.isFinite(n) ? n : 0xffffff;
    v = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const s = ((c >> (16 - 8 * i)) & 255) / 255;
      v[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }
    hexCache.set(hex, v);
  }
  if (out) {
    out.set(v);
    return out;
  }
  return v;
}

// ---- tone-map compensation -------------------------------------------------------------------------------------
// three's ACESFilmicToneMapping (what render/post.ts's composite applies at exposure 1), mirrored on the CPU.

/** channel cap of the compensated fill (linear HDR): below the bloom knee, so digits stay crisp instead of glowing */
export const HDR_FILL_MAX = 1.15;
/**
 * ...and its floor. ACES' colour matrices leak light into the channels a pure hue leaves empty (a lemon yellow with blue 0
 * comes out butter-gold, blue ~110 / 255), so a saturated fill is stored with a slightly NEGATIVE weak channel: the HDR target
 * is a half-float buffer and the tone mapper clamps the result back to 0..1, so the leak is cancelled instead of washed in.
 */
export const HDR_FILL_MIN = -0.35;

/** tone-mapped (display-linear 0..1) result of a linear HDR colour; writes `out` */
export function acesDisplay(r: number, g: number, b: number, out: Float32Array | number[], exposure = 1): void {
  const k = exposure / 0.6;
  const x = r * k;
  const y = g * k;
  const z = b * k;
  const a0 = 0.59719 * x + 0.35458 * y + 0.04823 * z;
  const a1 = 0.076 * x + 0.90834 * y + 0.01566 * z;
  const a2 = 0.0284 * x + 0.13383 * y + 0.83777 * z;
  const fit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const f0 = fit(a0);
  const f1 = fit(a1);
  const f2 = fit(a2);
  out[0] = clamp(1.60475 * f0 - 0.53108 * f1 - 0.07367 * f2, 0, 1);
  out[1] = clamp(-0.10208 * f0 + 1.10813 * f1 - 0.00605 * f2, 0, 1);
  out[2] = clamp(-0.00327 * f0 - 0.07276 * f1 + 1.07602 * f2, 0, 1);
}

const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const fillCache = new Map<string, Float32Array>();
const SOLVER_STARTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.3, 0.1],
  [1, 0.5, 0],
  [0.2, 0.6, 1],
  [0.8, 0.1, 0.9],
  [0.1, 0.6, 0.2],
  [0.9, 0.9, 0.5],
  [1.1, 1.0, -0.3],
  [1.1, -0.1, -0.1],
];

/**
 * Linear HDR fill whose ACES-tone-mapped result is closest (in display space) to `hex`, channels within [HDR_FILL_MIN, HDR_FILL_MAX].
 * Cached per colour. This is what makes "flat saturated yellow / red" read as such after the post composite.
 */
export function hdrFill(hex: string, exposure = 1): Float32Array {
  const key = exposure === 1 ? hex : `${hex}@${exposure}`;
  const hit = fillCache.get(key);
  if (hit) return hit;
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  const n = parseInt(full.slice(0, 6), 16);
  const c = Number.isFinite(n) ? n : 0xffffff;
  const tgt = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  const o = [0, 0, 0];
  const dispErr = (r: number, g: number, b: number): number => {
    acesDisplay(r, g, b, o, exposure);
    let e = 0;
    for (let i = 0; i < 3; i++) {
      const d = toSrgb(o[i] as number) - (tgt[i] as number);
      e += d * d;
    }
    return e;
  };
  /** what is left of a fill when its negative (cancelling) channels are dropped, i.e. while the number fades out */
  const keptErr = (x: number[]): number => dispErr(Math.max(0, x[0] as number), Math.max(0, x[1] as number), Math.max(0, x[2] as number));
  const solve = (wKept: number): number[] => {
    const err = (x: number[]): number => dispErr(x[0] as number, x[1] as number, x[2] as number) + (wKept > 0 ? wKept * keptErr(x) : 0);
    let best: number[] = [0, 0, 0];
    let bestE = Infinity;
    for (const st of SOLVER_STARTS) {
      const x = [st[0], st[1], st[2]];
      let e = err(x);
      let step = 0.3;
      while (step > 0.004) {
        let improved = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nx = [clamp((x[0] as number) + dx * step, HDR_FILL_MIN, HDR_FILL_MAX), clamp((x[1] as number) + dy * step, HDR_FILL_MIN, HDR_FILL_MAX), clamp((x[2] as number) + dz * step, HDR_FILL_MIN, HDR_FILL_MAX)];
              const ne = err(nx);
              if (ne < e - 1e-9) {
                x[0] = nx[0] as number;
                x[1] = nx[1] as number;
                x[2] = nx[2] as number;
                e = ne;
                improved = true;
              }
            }
          }
        }
        if (!improved) step *= 0.5;
      }
      if (e < bestE) {
        bestE = e;
        best = x;
      }
    }
    return best;
  };
  let best = solve(0);
  // The unconstrained optimum can lean on ACES' behaviour for negative inputs: the xp blue came out as (0.47, -0.22, -0.35), whose
  // non-negative part is pure RED, so the fading '+12' went blue -> purple -> an orange-red ghost. Such a colour is solved again
  // with its non-negative part held to the hue too (a small weight, so the yellow / red / amber fills keep their solution).
  if (keptErr(best) > 0.25) best = solve(0.05);
  const v = Float32Array.from(best);
  fillCache.set(key, v);
  return v;
}

/**
 * Spawn pop: scale multiplier over age (s). Normal: quick 1.22x overshoot; crit: 1.16x punch that settles without a wobble (the
 * starburst behind it carries the impact, and a wide overshoot made two neighbouring numbers touch for the first ~0.1 s).
 */
export function popScale(age: number, crit: boolean): number {
  if (age <= 0) return crit ? 0.3 : 0.4;
  if (crit) {
    const tp = 0.05;
    if (age < tp) return 0.3 + (1.16 - 0.3) * easeOutQuad(age / tp);
    const d = age - tp;
    return 1 + 0.16 * Math.exp(-d * 14);
  }
  const tp = 0.06;
  if (age < tp) return 0.4 + (1.22 - 0.4) * easeOutQuad(age / tp);
  const d = age - tp;
  return 1 + 0.22 * Math.exp(-d * 17);
}


export function fadeAlpha(age: number, life: number, fadeFrac = 0.3): number {
  const u = age / life;
  const out = smooth01((1 - u) / fadeFrac);
  const inn = clamp(age / 0.03, 0, 1);
  return out * inn;
}

/** where the arc peaks, as a fraction of the life (a crit lives longer, so its apex comes a touch earlier) */
export const ARC_APEX = 0.42;
export const ARC_APEX_CRIT = 0.4;







export function arcOffset(tau: number, crit: boolean, rise: number): number {
  const apex = crit ? ARC_APEX_CRIT : ARC_APEX;
  const u = clamp(tau, 0, 1);
  const q = (u - apex) / apex;
  return rise * (1 - q * q);
}

/**
 * Sideways throw (screen px) over the life fraction `tau`: ONE sign per number and monotone (a constant-velocity throw with a
 * slight ease-out), so a number is thrown one way and never swings back (the capture of round 2 showed a zig-zag only because the
 * alternating fan state survived `field.clear()` between two captures).
 */
export function driftOffset(tau: number, drift: number): number {
  const u = clamp(tau, 0, 1);
  return drift * u * (1.14 - 0.14 * u);
}





export function endShrink(tau: number, crit = false): number {
  const from = crit ? 0.55 : 0.5;
  return 1 - (crit ? 0.28 : 0.4) * smooth01((tau - from) / (1 - from));
}





export const BURST_LIFE = 0.5;
export function burstEnvelope(age: number): { scale: number; alpha: number } {
  if (!(age >= 0) || age >= BURST_LIFE) return { scale: 0, alpha: 0 };
  const grow = 0.25 + 0.75 * easeOutCubic(age / 0.12);
  const expand = 1 + 0.2 * smooth01((age - 0.1) / 0.4);
  const fadeIn = clamp(age / 0.02, 0, 1);
  const fadeOut = 1 - smooth01((age - 0.2) / (BURST_LIFE - 0.2));
  return { scale: grow * expand, alpha: fadeIn * fadeOut };
}

// ---- layout ----------------------------------------------------------------------------------------------------

export const MAX_GLYPHS = 12;
/** the letters of the hollow mixed-case words (Miss, Block; Turkish Iska, Blok), drawn as control-character aliases of the atlas */
export const HOLLOW_LETTERS = 'MisBlockIa';
const hollowAlias = (letter: string): string => {
  const i = HOLLOW_LETTERS.indexOf(letter);
  return i < 0 ? '' : String.fromCharCode(1 + i);
};
/** alias character -> the real letter it is drawn from (hollow glyphs only) */
const HOLLOW_REAL: Record<string, string> = {};
for (let i = 0; i < HOLLOW_LETTERS.length; i++) HOLLOW_REAL[String.fromCharCode(1 + i)] = HOLLOW_LETTERS[i] as string;
/** digits + the compact-amount letters + punctuation, the capitals of the xp text (+N XP), then the hollow word letters */
export const GLYPH_CHARS = '0123456789KMB.,!+-%xISLOCAXP' + Object.keys(HOLLOW_REAL).join('');

/** Per-glyph metrics in atlas pixels (y up). Filled by the atlas builder; tests build synthetic tables. */
export class GlyphTable {
  readonly count: number;
  readonly adv: Float32Array;
  readonly inkX0: Float32Array;
  readonly inkX1: Float32Array;
  /** rect centre relative to the pen position (x) / relative to the number's vertical centre (y) */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  /** rect size incl. padding */
  readonly w: Float32Array;
  readonly h: Float32Array;
  readonly u0: Float32Array;
  readonly v0: Float32Array;
  readonly u1: Float32Array;
  readonly v1: Float32Array;
  private readonly lookup = new Int16Array(128).fill(-1);

  constructor(readonly chars: string) {
    const n = chars.length;
    this.count = n;
    this.adv = new Float32Array(n);
    this.inkX0 = new Float32Array(n);
    this.inkX1 = new Float32Array(n);
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.w = new Float32Array(n);
    this.h = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.u1 = new Float32Array(n);
    this.v1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = chars.charCodeAt(i);
      if (c < 128) this.lookup[c] = i;
    }
  }

  indexOf(ch: string): number {
    const c = ch.charCodeAt(0);
    return c < 128 ? (this.lookup[c] as number) : -1;
  }

  /** advance of a blank (a third of a digit's) */
  get spaceAdv(): number {
    const z = this.indexOf('0');
    return z >= 0 ? (this.adv[z] as number) * 0.36 : 0;
  }
}

/**
 * Lays `text` out left to right; writes glyph indices + rect-centre x (atlas px, centred on the ink extents)
 * into the output arrays. Returns the number of glyphs written (unknown characters are skipped, a blank advances the pen).
 */
export function layoutText(table: GlyphTable, text: string, glyphs: Uint8Array, gx: Float32Array): number {
  let n = 0;
  let pen = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < text.length && n < glyphs.length; i++) {
    const ch = text[i] as string;
    if (ch === ' ') {
      if (n > 0) pen += table.spaceAdv;
      continue;
    }
    const gi = table.indexOf(ch);
    if (gi < 0) continue;
    if (n === 0) left = pen + (table.inkX0[gi] as number);
    right = pen + (table.inkX1[gi] as number);
    glyphs[n] = gi;
    gx[n] = pen + (table.cx[gi] as number);
    pen += table.adv[gi] as number;
    n++;
  }
  const mid = (left + right) * 0.5;
  for (let i = 0; i < n; i++) gx[i] = (gx[i] as number) - mid;
  return n;
}

/** Ink width of a laid-out number (atlas px). */
export function textWidth(table: GlyphTable, glyphs: Uint8Array, gx: Float32Array, len: number): number {
  if (len <= 0) return 0;
  const g0 = glyphs[0] as number;
  const g1 = glyphs[len - 1] as number;
  const l = (gx[0] as number) - ((table.inkX1[g0] as number) - (table.inkX0[g0] as number)) / 2;
  const r = (gx[len - 1] as number) + ((table.inkX1[g1] as number) - (table.inkX0[g1] as number)) / 2;
  return r - l;
}

/** Shelf packing of rectangles into a fixed-width atlas; positions keep the input order. */
export function packShelves(
  sizes: ReadonlyArray<{ w: number; h: number }>,
  maxWidth: number,
  gap: number,
): { x: number[]; y: number[]; width: number; height: number } {
  const x: number[] = [];
  const y: number[] = [];
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const s of sizes) {
    if (cx > 0 && cx + s.w > maxWidth) {
      cx = 0;
      cy += rowH + gap;
      rowH = 0;
    }
    x.push(cx);
    y.push(cy);
    cx += s.w + gap;
    if (s.h > rowH) rowH = s.h;
  }
  return { x, y, width: maxWidth, height: cy + rowH };
}

/** In-place separable box blur (zero outside), `passes` times — three passes ≈ gaussian. */
export function boxBlur(buf: Float32Array, w: number, h: number, radius: number, passes: number, tmp: Float32Array): void {
  if (radius < 1) return;
  const k = 1 / (2 * radius + 1);
  for (let p = 0; p < passes; p++) {
    for (let yy = 0; yy < h; yy++) {
      const row = yy * w;
      let sum = 0;
      for (let i = 0; i <= radius && i < w; i++) sum += buf[row + i] as number;
      for (let xx = 0; xx < w; xx++) {
        tmp[row + xx] = sum * k;
        const add = xx + radius + 1;
        const sub = xx - radius;
        if (add < w) sum += buf[row + add] as number;
        if (sub >= 0) sum -= buf[row + sub] as number;
      }
    }
    for (let xx = 0; xx < w; xx++) {
      let sum = 0;
      for (let i = 0; i <= radius && i < h; i++) sum += tmp[i * w + xx] as number;
      for (let yy = 0; yy < h; yy++) {
        buf[yy * w + xx] = sum * k;
        const add = yy + radius + 1;
        const sub = yy - radius;
        if (add < h) sum += tmp[add * w + xx] as number;
        if (sub >= 0) sum -= tmp[sub * w + xx] as number;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pure number field (aggregation / caps / budget / ageing)

/** shader style ids */
const STYLE_NORMAL = 0;
const STYLE_CRIT = 1;
const STYLE_PLAYER = 2;
const STYLE_HEAL = 3;
const STYLE_MINOR = 4;
/** hollow mixed-case word (Miss / Block) */
const STYLE_WORD = 5;

const KIND_INDEX: Record<DamageKind, number> = { normal: 0, heal: 1, player: 2, xp: 3, yeop: 4, status: 5, word: 6 };
/** minor kinds were ~20 px blobs; every kind now reads at 0.95 or more of a plain hit */
const KIND_SIZE: Record<DamageKind, number> = { normal: 1.0, heal: 1.1, player: 1.25, xp: 0.95, yeop: 0.98, status: 0.95, word: 1.15 };

const KIND_LIFE: Record<DamageKind, number> = { normal: 0.74, heal: 0.9, player: 0.95, xp: 0.9, yeop: 0.78, status: 0.7, word: 0.9 };




const CRIT_SIZE = 1.35;
const CRIT_LIFE = 0.92;
/** the alpha fade covers this share of the end of the life */
const FADE_PLAIN = 0.28;
const FADE_CRIT = 0.25;
/**
 * DMG-01. Hits on one enemy fold into ONE number while each lands within this many seconds of the one before; the number shows the
 * running total at the last hit (it glides there). Every hit that joins sets the number back to MERGE_TAU of its life (at most): it
 * hangs near the top of its arc, full size, while the hits keep coming, and still has more than half a second to be read after the
 * last one. A number that has started to fade (MERGE_FADE_FROM) is never merged into, and a chain ends after MERGE_CHAIN_MAX s.
 */
export const NUMBER_MERGE_WINDOW = 0.25;
const MERGE_TAU = 0.3;
const MERGE_FADE_FROM = 0.7;
const MERGE_CHAIN_MAX = 1.2;
/** a number that moves to the last hit glides there over this long (s) instead of jumping */
const GLIDE_T = 0.12;
/** a retired number (replaced by a bigger hit) fades out over this long (s): nothing is ever cut off at full strength */
const RETIRE_T = 0.12;
/**
 * Who may be replaced by a new hit, by how much the number has lived (s) and how much of its life is left:
 * unseen (never drawn) = by any bigger hit; not yet readable (< READ_MIN) = only by READ_MARGIN x its size, so a number the eye has
 * barely met does not pop and vanish; readable = 1.2x; and a number with TAKE_LEFT s or less to live is as good as gone: ANY hit takes
 * its place, a smaller one too, so a burst that expires together never leaves a gap with no hit number on screen.
 */
const READ_MARGIN = 2;
const READ_MIN = 0.3;
const TAKE_LEFT = 0.25;
/**
 * ... and a hit feedback floor: while fewer than FRESH_MIN of the hero's numbers in a capped class are younger than READ_MIN, a new hit
 * takes the weakest number that has been read, unless that one is worth more than 1 / FRESH_REL times the hit. A volley that lands on a
 * field full of one burst's numbers (all the same age) is thus told, not lost, and a big total is never moved by a chip.
 */
const FRESH_MIN = 2;
const FRESH_REL = 0.25;
/** recent plain hits whose median ranks a number: chips (< CHIP_REL of it) are drawn smaller and fade faster, totals well above it bigger */
const MEDIAN_N = 32;
const MEDIAN_MIN = 8;
const CHIP_REL = 0.15;
const CHIP_SIZE = 0.8;
const CHIP_LIFE = 0.7;
const FADE_CHIP = 0.45;
/**
 * Co-op. A partner's numbers may hold at most this share of a capped class (but always PARTNER_FLOOR places: a full class retires the
 * hero's weakest readable number for them). The hero's hits only take a partner's number that has been up for PARTNER_HOLD s, and
 * count it at PARTNER_SHARE of its size; a partner's numbers keep their places against another partner hit by the same margins as the
 * hero's do, so they are never retired again within a blink.
 */
const PARTNER_SHARE = 0.25;
const PARTNER_FLOOR = 1;
const PARTNER_HOLD = 0.4;
/** player-damage numbers keep stacking into one counter for this long (s); heals and xp / yeop pickups likewise */
const PLAYER_MERGE_WINDOW = 0.45;
const KIND_MERGE_WINDOW: Partial<Record<DamageKind, number>> = { player: PLAYER_MERGE_WINDOW, heal: 0.6, xp: 0.9, yeop: 0.5, word: 0.35 };
/** hero keep-out for numbers (m): sideways offset, and the depth band (north / south of the hero) it applies to */
const KEEP_OUT_X = 1.1;
const KEEP_OUT_NORTH = 0.8;
const KEEP_OUT_SOUTH = 3.5;
/** apex height of the arc (screen px at 1080 p) */
const KIND_RISE: Record<DamageKind, number> = { normal: 70, heal: 80, player: 66, xp: 52, yeop: 56, status: 58, word: 68 };
/** drop order when the glyph cap is hit: lower priority goes first (a pickup counter is ONE number: it ranks above a plain hit) */
const KIND_PRIORITY: Record<DamageKind, number> = { status: 1, normal: 1, xp: 2, yeop: 2, heal: 2, player: 3, word: 3 };
/** digit height as a fraction of the font size (the spacing boxes) */
const DIGIT_H = 0.82;
/** crowd scale: full size up to this many live numbers, then a linear shrink down to the floor */
const CROWD_FREE = 9;
const CROWD_SLOPE = 0.013;
const CROWD_MIN = 0.7;

/**
 * the throws tried for a new number, cheapest first: [shift in number widths, lift in digit heights, drift sign]. A number
 * pushed beside the hero keeps its side: it never flips and only shifts OUTWARD (away from the hero) or lifts.
 */
type Throw = readonly [number, number, number];
const throwCost = (t: Throw): number => 0.02 * (Math.abs(t[0]) + Math.abs(t[1])) + (t[2] < 0 ? 0.008 : 0);
function buildThrows(side: boolean): Throw[] {
  const out: Throw[] = [];
  for (const fx of side ? [0, 0.5, 1, 1.5, 2] : [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2]) for (const fy of [0, 1, 2, 3, -1, 4, -2]) for (const fl of side ? [1] : [1, -1]) out.push([fx, fy, fl]);
  return out.sort((a, b) => throwCost(a) - throwCost(b));
}
const THROWS = buildThrows(false);
const THROWS_SIDE = buildThrows(true);

/** scratch box of the spacing code: centre x, centre y, half width, half height (px) */
const BOX = new Float32Array(4);
/** the times (s after a spawn) at which a new number's box is checked against the live ones */
const SPACING_T: readonly number[] = [0.04, 0.09, 0.16, 0.26, 0.4, 0.55, 0.7];
/** the first instants count most: that is when a number is biggest and the eye reads it ("45212310" at 0.1 s) */
const SPACING_W: readonly number[] = [2, 2.4, 1.6, 1.1, 1, 0.8, 0.5];

/** live plain hits per quality tier (160 / 320 / 600 / 900 glyphs): DMG-01 keeps the field calm, the biggest hits win the places */
export function plainCapFor(glyphCap: number): number {
  return glyphCap >= 900 ? 14 : glyphCap >= 600 ? 10 : glyphCap >= 320 ? 8 : 6;
}
/** live crits per quality tier (each carries a starburst) */
export function critCapFor(glyphCap: number): number {
  return glyphCap >= 900 ? 7 : glyphCap >= 600 ? 5 : glyphCap >= 320 ? 4 : 3;
}
/** size step of a total against the recent median hit: 1 up to twice the median, +15 % from about eight times it */
export function rankScale(rel: number): number {
  return rel > 2 ? 1 + 0.15 * smooth01(Math.log2(rel / 2) / 2) : 1;
}

export class NumberSlot {
  alive = false;
  x = 0;
  y = 0;
  z = 0;
  age = 0;
  life = 1;
  amount = 0;
  bestAmount = 0;
  crit = false;
  kind: DamageKind = 'normal';
  style = STYLE_NORMAL;
  priority = 1;
  /** drawn in the on-top pass */
  top = false;
  targetId = 0;
  mergeKey = 0;
  r = 1;
  g = 1;
  b = 1;
  /** element hue (linear rgb) of a number we deal: tints its outline and its crit's starburst; `tint` 0 = none (physical) */
  tr = 1;
  tg = 1;
  tb = 1;
  tint = 0;
  /** base size multiplier (kind × value boost × crowd) */
  size = 1;
  /** share of the normal size this number was given because the field was crowded when it spawned (1 = alone) */
  crowd = 1;
  rise = 82;
  sx0 = 0;
  sy0 = 0;
  drift = 0;
  /** screen position of the anchor (px at the 1080 p reference, y up), NaN = unknown (no spacing) */
  ax = Number.NaN;
  ay = 0;
  /** seconds since the last merge pulse; large = no pulse */
  bump = 9;
  /** seconds since the last hit joined this number (an enemy's hits fold into it while this stays under the merge window) */
  since = 0;
  /** seconds since the number was born (a chain of merges ends at MERGE_CHAIN_MAX) */
  chain = 0;
  /** 1 = live; counts down to 0 while the number is retired (replaced by a bigger hit): it fades out, it is never cut */
  out = 1;
  /** dealt by the local hero (false: a co-op partner) */
  mine = true;
  /** the hero side (-1 / 0 / +1) the number is kept on */
  side = 0;
  /** a chip: far below the recent median hit (drawn smaller, fades faster) */
  chip = false;
  /** screen offset (px) a merge that moved the number left behind; it decays to 0 over GLIDE_T (`ga` = s since the move) */
  glx = 0;
  gly = 0;
  ga = 9;
  len = 0;
  /** ink width of the laid-out text (atlas px) */
  width = 0;
  text = '';
  word = '';
  readonly glyphs = new Uint8Array(MAX_GLYPHS);
  readonly gx = new Float32Array(MAX_GLYPHS);
}

export interface FieldOptions {
  glyphCap: number;
  table: GlyphTable;
  rng?: () => number;
  critSuffix?: boolean;
  /** merge window (s) for hits on the same target */
  mergeWindow?: number;
  /** max new low-priority numbers per frame; defaults to glyphCap/16 (min 8) */
  budget?: number;
  /** max live plain hits / DoT ticks: a new one beyond it replaces a clearly smaller one (which fades out) or is dropped */
  lowCap?: number;
  /** max live crits: the biggest stay */
  critCap?: number;
}

export class DamageNumberField {
  /** alive numbers in spawn order, valid for [0,count) */
  readonly slots: NumberSlot[] = [];
  count = 0;
  glyphsInUse = 0;
  glyphCap: number;
  table: GlyphTable;
  critSuffix: boolean;
  mergeWindow: number;
  budget: number;
  lowCap: number;
  /** on-screen px per atlas px at size 1 (set by the renderer from its font size); used by edge-anchored numbers */
  pxPerAtlas = 0.4;
  critCap: number;
  /** settings "crits only": a crit with no room in the crit class is dropped, never told as a plain number */
  critOnly = false;
  /**
   * Projects a world point to the number anchor space (px at the 1080 p reference, y up) through the CURRENT camera. Set by the
   * renderer: the live numbers' screen anchors are taken again once per frame (at the first spawn), so a merge glides from where the
   * number is really drawn even while the camera follows a running hero.
   */
  projector: ((x: number, y: number, z: number, out: Float64Array) => void) | null = null;
  private frameNo = 0;
  private anchorFrame = -1;
  private readonly pxy = new Float64Array(2);
  /** live (not retiring) plain hits / crits, and a co-op partner's share of each (recounted every update) */
  private plainAlive = 0;
  private critAlive = 0;
  private partnerPlain = 0;
  private partnerCrit = 0;
  /** the last MEDIAN_N plain hits and their median (0 until MEDIAN_MIN are known) */
  private readonly ring = new Float32Array(MEDIAN_N);
  private readonly ringTmp = new Float32Array(MEDIAN_N);
  private ringN = 0;
  private ringI = 0;
  private median = 0;
  private readonly explicitBudget: boolean;
  private readonly rng: () => number;
  private readonly free: NumberSlot[] = [];
  private readonly hash: Array<NumberSlot | null> = new Array<NumberSlot | null>(1024).fill(null);
  private spawnedThisFrame = 0;
  /** alternates the sideways fan of consecutive numbers so a cluster spreads instead of stacking */
  private fan = 1;
  stats = { spawned: 0, merged: 0, dropped: 0, evicted: 0 };

  constructor(o: FieldOptions) {
    this.glyphCap = o.glyphCap;
    this.table = o.table;
    this.rng = o.rng ?? Math.random;
    this.critSuffix = o.critSuffix ?? true;
    this.mergeWindow = o.mergeWindow ?? NUMBER_MERGE_WINDOW;
    this.explicitBudget = o.budget !== undefined;
    this.budget = o.budget ?? Math.max(8, Math.floor(o.glyphCap / 16));
    this.lowCap = o.lowCap ?? Infinity;
    this.critCap = o.critCap ?? Infinity;
  }

  setGlyphCap(cap: number): void {
    this.glyphCap = cap;
    if (!this.explicitBudget) this.budget = Math.max(8, Math.floor(cap / 16));
    while (this.glyphsInUse > cap && this.count > 0) {
      this.removeAt(this.pickVictim(99, Infinity));
      this.stats.evicted++;
    }
  }

  /** New atlas metrics (font swap): re-lay every live number out. */
  setTable(table: GlyphTable): void {
    this.table = table;
    this.glyphsInUse = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i] as NumberSlot;
      s.len = layoutText(table, s.text, s.glyphs, s.gx);
      s.width = textWidth(table, s.glyphs, s.gx, s.len);
      this.glyphsInUse += s.len;
    }
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.release(this.slots[i] as NumberSlot);
    this.count = 0;
    this.glyphsInUse = 0;
    this.plainAlive = this.critAlive = this.partnerPlain = this.partnerCrit = 0;
    this.ringN = this.ringI = this.median = 0;
    this.anchorFrame = -1;
    this.hash.fill(null);
    // the sideways fan restarts from the same side: two identical scenes throw their numbers identically
    this.fan = 1;
  }

  /**
   * Returns false when the number was dropped (budget, capacity). Merges count as handled (true).
   * `side` (-1 / +1) anchors the number by its inner edge instead of its centre and drifts it outward: used for numbers
   * pushed beside the hero, so their full width (crits are wide) stays clear of the body.
   * `ax, ay` = the screen position of the anchor (px at the 1080 p reference, y up): with it the number is thrown where its box
   * stays clear of the numbers already alive (see `place`); without it the throw is just the alternating fan.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    amount: number,
    kind: DamageKind,
    crit: boolean,
    colorHex?: string,
    targetId = 0,
    side = 0,
    word = '',
    ax = Number.NaN,
    ay = 0,
    mine = true,
  ): boolean {
    if (!(amount > 0)) return false;
    if (kind !== 'normal') crit = false;
    if (kind === 'word' && word === '') return false;
    if (kind === 'normal' && !crit) this.noteHit(amount);
    if (ax === ax) this.refreshAnchors();
    const key = targetId !== 0 ? targetId * 8 + KIND_INDEX[kind] : 0;
    let h = 0;
    if (key !== 0) {
      h = Math.imul(key, 0x9e3779b1) >>> 22;
      const e = this.hash[h];
      if (e !== null && e !== undefined && e.alive && e.out === 1 && e.mergeKey === key && this.canMerge(e, kind)) {
        // a plain total becomes a crit only while the crit class has a free place
        this.merge(e, amount, crit && !e.crit && this.room(true, amount, mine) === -2, colorHex, x, y, z, side, ax, ay);
        this.stats.merged++;
        return true;
      }
    }
    let priority = crit ? 4 : (KIND_PRIORITY[kind] as number);
    // the two capped classes (plain hits / DoT ticks, crits): a full class takes a new number only in place of a clearly smaller one
    let place = -2;
    if (priority === 1 || priority === 4) {
      place = this.room(priority === 4, amount, mine);
      if (place === -1 && crit && !this.critOnly) {
        // no room among the crits: it is told as a plain (big) number, never hidden (not in "crits only": plain numbers are off there)
        crit = false;
        priority = 1;
        place = this.room(false, amount, mine);
      }
      // the per-frame budget limits additions, not replacements (an AoE frame keeps its biggest numbers)
      if (place === -1 || (place === -2 && priority === 1 && this.spawnedThisFrame >= this.budget)) {
        this.stats.dropped++;
        return false;
      }
      if (place >= 0) this.retire(place);
    }
    const s = this.free.pop() ?? new NumberSlot();
    s.word = word;
    s.text = damageText(amount, kind, crit, this.critSuffix, word);
    s.len = layoutText(this.table, s.text, s.glyphs, s.gx);
    if (s.len === 0) {
      this.free.push(s);
      return false;
    }
    while (this.glyphsInUse + s.len > this.glyphCap) {
      const v = this.pickVictim(priority, amount);
      if (v < 0) {
        this.free.push(s);
        this.stats.dropped++;
        return false;
      }
      this.removeAt(v);
      this.stats.evicted++;
    }
    s.width = textWidth(this.table, s.glyphs, s.gx, s.len);
    s.alive = true;
    s.x = x;
    s.y = y;
    s.z = z;
    s.age = 0;
    s.amount = amount;
    s.bestAmount = amount;
    s.kind = kind;
    s.targetId = targetId;
    s.mergeKey = key;
    s.priority = priority;
    s.mine = mine;
    s.side = side;
    s.since = 0;
    s.chain = 0;
    s.out = 1;
    s.glx = s.gly = 0;
    s.ga = 9;
    this.applyStyle(s, crit, colorHex);
    this.fan = -this.fan;
    s.sx0 = (this.rng() * 2 - 1) * 12;
    s.sy0 = this.rng() * 14;
    // a sideways throw: the sign alternates between consecutive numbers (clusters fan out), the size is random
    s.drift = this.fan * (20 + this.rng() * 26);
    if (side !== 0) {
      const last = s.len - 1;
      const gl = s.glyphs[last] as number;
      const halfAtlas = Math.abs(s.gx[last] as number) + 0.5 * ((this.table.inkX1[gl] as number) - (this.table.inkX0[gl] as number));
      // ×1.2: room for the spawn pop overshoot
      s.sx0 = side * (halfAtlas * this.pxPerAtlas * s.size * 1.2 + 6);
      s.drift = side * Math.abs(s.drift);
    }
    s.ax = ax;
    s.ay = ay;
    this.place(s, side);
    s.bump = 9;
    this.slots[this.count++] = s;
    this.glyphsInUse += s.len;
    this.spawnedThisFrame++;
    this.tally(s, 1);
    this.stats.spawned++;
    if (key !== 0) this.hash[h] = s;
    return true;
  }

  /** takes the screen anchor of every live number again through the current camera (once per frame, at the first spawn that needs it) */
  private refreshAnchors(): void {
    const p = this.projector;
    if (p === null || this.anchorFrame === this.frameNo) return;
    this.anchorFrame = this.frameNo;
    const o = this.pxy;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i] as NumberSlot;
      if (!(s.ax === s.ax)) continue;
      p(s.x, s.y, s.z, o);
      const nx = o[0] as number;
      const ny = o[1] as number;
      if (nx - nx === 0 && ny - ny === 0) {
        s.ax = nx;
        s.ay = ny;
      }
    }
  }

  update(dt: number): void {
    this.spawnedThisFrame = 0;
    this.frameNo++;
    let w = 0;
    this.plainAlive = this.critAlive = this.partnerPlain = this.partnerCrit = 0;
    for (let r = 0; r < this.count; r++) {
      const s = this.slots[r] as NumberSlot;
      s.age += dt;
      s.bump += dt;
      s.since += dt;
      s.chain += dt;
      s.ga += dt;
      if (s.out < 1) s.out -= dt / RETIRE_T;
      if (s.age >= s.life || s.out <= 0) {
        this.glyphsInUse -= s.len;
        this.release(s);
      } else {
        this.slots[w++] = s;
        this.tally(s, 1);
      }
    }
    this.count = w;
  }

  /** counts a live number into its capped class (plain hit / crit) and, for a co-op partner, into the partner's share */
  private tally(s: NumberSlot, d: number): void {
    if (s.out < 1) return;
    if (s.priority === 1) {
      this.plainAlive += d;
      if (!s.mine) this.partnerPlain += d;
    } else if (s.priority === 4) {
      this.critAlive += d;
      if (!s.mine) this.partnerCrit += d;
    }
  }

  /** the last MEDIAN_N plain (non-crit) hits; their median ranks a number's size */
  private noteHit(amount: number): void {
    this.ring[this.ringI++ % MEDIAN_N] = amount;
    if (this.ringN < MEDIAN_N) this.ringN++;
    if (this.ringI % 4 !== 0 || this.ringN < MEDIAN_MIN) return;
    const t = this.ringTmp.subarray(0, this.ringN);
    t.set(this.ring.subarray(0, this.ringN));
    t.sort();
    this.median = t[this.ringN >> 1] as number;
  }

  private canMerge(e: NumberSlot, kind: DamageKind): boolean {
    const w = KIND_MERGE_WINDOW[kind];
    return w !== undefined ? e.age <= w : e.since <= this.mergeWindow && e.chain < MERGE_CHAIN_MAX && e.age < e.life * MERGE_FADE_FROM;
  }

  /**
   * Room in a capped class for a new number: -2 = a free place, -1 = none (drop it), i = the index of the number it replaces. A full
   * class gives a place only to a clearly bigger hit, and takes it from the weakest number it may take it from: one nobody has seen
   * yet (any bigger hit), one not yet readable (2x), one readable (1.2x), and one with TAKE_LEFT s or less to
   * live (ANY hit); and while fewer than FRESH_MIN of the hero's numbers are fresh, the weakest one that has been read (the feedback
   * floor, FRESH_REL). Co-op: a partner holds at most PARTNER_SHARE of a class (at least PARTNER_FLOOR places) and replaces only its own
   * numbers, by the same margins; when it holds none and the class is full it may retire the hero's weakest number that has been read
   * (so a partner at equal strength is not hidden). The hero's hit takes a partner's number once it has been up for PARTNER_HOLD s,
   * counted at PARTNER_SHARE of its size, and never the partner's last place (unless it is about to go anyway).
   */
  private room(crit: boolean, amount: number, mine: boolean): number {
    const cap = crit ? this.critCap : this.lowCap;
    const theirs = crit ? this.partnerCrit : this.partnerPlain;
    const pcap = Math.max(PARTNER_FLOOR, Math.round(cap * PARTNER_SHARE));
    if ((crit ? this.critAlive : this.plainAlive) < cap && (mine || theirs < pcap)) return -2;
    const cls = crit ? 4 : 1;
    const floor = !mine && theirs < PARTNER_FLOOR;
    let best = -1;
    let bestW = Infinity;
    let fresh = 0;
    let old = -1;
    let oldW = Infinity;
    for (let i = 0; i < this.count; i++) {
      const v = this.slots[i] as NumberSlot;
      if (v.priority !== cls || v.out < 1) continue;
      if (mine && v.mine) {
        if (v.age < READ_MIN) fresh++;
        else if (amount > v.amount * FRESH_REL && v.amount * (1 - v.age / v.life) < oldW) {
          old = i;
          oldW = v.amount * (1 - v.age / v.life);
        }
      }
      const left = v.life - v.age;
      const tau = v.age / v.life;
      let disc = 1;
      let margin = v.age <= 0 ? 1 : left <= TAKE_LEFT ? 0 : v.age < READ_MIN ? READ_MARGIN : 1.2;
      if (v.mine) {
        // a partner's hit only takes one of the hero's numbers for its floor: one that has been read already, whatever its size
        if (!mine) {
          if (!floor || v.age < READ_MIN) continue;
          margin = 0;
        }
      } else if (mine) {
        // the hero's hit and a partner's number: held for PARTNER_HOLD s, its last place kept, then counted at a share of its size
        if (left > TAKE_LEFT && (v.age < PARTNER_HOLD || theirs <= PARTNER_FLOOR)) continue;
        disc = PARTNER_SHARE;
      }
      const w = v.amount * (1 - tau) * disc;
      if (w < bestW && amount > v.amount * margin * disc) {
        best = i;
        bestW = w;
      }
    }
    return best < 0 && fresh < FRESH_MIN ? old : best;
  }

  /** takes a number off its class: never drawn = gone, else it fades out over RETIRE_T (and no longer counts) */
  private retire(i: number): void {
    const s = this.slots[i] as NumberSlot;
    this.stats.evicted++;
    if (s.age <= 0) {
      this.removeAt(i);
      return;
    }
    this.tally(s, -1);
    s.out = 0.9999;
  }

  /**
   * Crowd scale: with 30 enemies around, a number born into a field of ~10+ live ones is drawn smaller (down to 0.7x of its size) so
   * the screen does not become one wall of yellow. Numbers about the hero (player damage, heals, words) never shrink; a crit shrinks
   * by the square root of it (it carries the burst and must still read first).
   */
  crowdScale(kind: DamageKind, crit: boolean): number {
    if (kind === 'player' || kind === 'heal' || kind === 'word') return 1;
    const k = clamp(1 - CROWD_SLOPE * (this.count - CROWD_FREE), CROWD_MIN, 1);
    return crit ? Math.sqrt(k) : k;
  }

  private applyStyle(s: NumberSlot, crit: boolean, colorHex: string | undefined): void {
    s.crit = crit;
    const kind = s.kind;
    s.style = kind === 'word' ? STYLE_WORD : crit ? STYLE_CRIT : kind === 'player' ? STYLE_PLAYER : kind === 'heal' ? STYLE_HEAL : kind === 'normal' ? STYLE_NORMAL : STYLE_MINOR;
    s.top = crit || kind === 'player' || kind === 'word';
    this.setColours(s, colorHex);
    s.crowd = this.crowdScale(kind, crit);
    s.size = this.sizeOf(s);
    s.life = (crit ? CRIT_LIFE : (KIND_LIFE[kind] as number)) * (s.chip ? CHIP_LIFE : 1);
    s.rise = (KIND_RISE[kind] as number) * (crit ? 1.15 : 1);
  }

  /**
   * Size of a number: its kind, the value boost, the crowd at its birth, and its rank against the recent median plain hit: a chip
   * (< CHIP_REL of it) is drawn at CHIP_SIZE and fades faster, a total well above it steps up (rankScale), and is never drawn smaller
   * than a live crit worth less than half of it (the bigger number must not look smaller). A merged total is re-ranked.
   */
  private sizeOf(s: NumberSlot): number {
    const kind = s.kind;
    const med = this.median;
    s.chip = (kind === 'normal' || kind === 'status') && !s.crit && med > 0 && s.amount < CHIP_REL * med;
    const boost = kind === 'normal' || kind === 'player' ? clamp(0.9 + 0.07 * Math.log10(Math.max(1, s.amount)), 0.9, 1.26) : 1;
    const rel = kind === 'normal' && !s.crit && med > 0 ? s.amount / med : 0;
    // a hit above the median does not shrink for the crowd it was born into (a big hit must never be drawn smaller than a chip)
    const crowd = rel > 1 ? s.crowd + (1 - s.crowd) * smooth01(rel - 1) : s.crowd;
    const size = (KIND_SIZE[kind] as number) * (s.crit ? CRIT_SIZE : 1) * boost * crowd * (s.chip ? CHIP_SIZE : 1) * (rel > 0 ? rankScale(rel) : 1);
    return kind === 'normal' && !s.crit && this.critAlive > 0 ? Math.max(size, this.critFloor(s.amount)) : size;
  }

  /** the size of the biggest live crit worth less than half of `amount` (0 = none) */
  private critFloor(amount: number): number {
    let f = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.slots[i] as NumberSlot;
      if (v.priority === 4 && v.out === 1 && v.amount * 2 < amount && v.size > f) f = v.size;
    }
    return f;
  }

  /**
   * Fill + element tint. Damage we deal (hits and DoT ticks) is ALWAYS the one lemon yellow; `colorHex` is then the element's
   * hue, which only tints the outline / starburst (none for physical). Every other kind is filled with `colorHex` or its default.
   */
  private setColours(s: NumberSlot, colorHex: string | undefined): void {
    const dealt = isDealt(s.kind);
    const lin = hdrFill(dealt ? DEALT_FILL : (colorHex ?? KIND_COLORS[s.kind]));
    s.r = lin[0] as number;
    s.g = lin[1] as number;
    s.b = lin[2] as number;
    if (dealt && colorHex !== undefined && colorHex.toLowerCase() !== DEALT_FILL) {
      const h = hexToLinear(colorHex);
      s.tr = h[0] as number;
      s.tg = h[1] as number;
      s.tb = h[2] as number;
      s.tint = 1;
    } else {
      s.tr = 0;
      s.tg = 0;
      s.tb = 0;
      s.tint = 0;
    }
  }

  // ---- spacing ---------------------------------------------------------------------------------------------------------
  /** box (px, y up) of a number `s` at `age`, when thrown with (sx0, sy0, drift): centre x / y and half sizes; into `BOX` */
  private boxAt(s: NumberSlot, age: number, sx0: number, sy0: number, drift: number): void {
    const tau = age / s.life;
    const scale = s.size * popScale(age, s.crit) * endShrink(tau, s.crit);
    const fontPx = this.pxPerAtlas * ATLAS_FONT_PX;
    BOX[0] = s.ax + sx0 + driftOffset(tau, drift);
    BOX[1] = s.ay + sy0 + arcOffset(tau, s.crit, s.rise);
    // a gap of ~2 x 14 px sideways / 2 x 8 px vertically is part of the box: two numbers 2 px apart read as one string ("2063508")
    BOX[2] = 0.5 * s.width * this.pxPerAtlas * scale + 14;
    BOX[3] = 0.5 * DIGIT_H * fontPx * scale + 8;
  }

  /**
   * Spacing: a cluster of numbers must not fuse into one string ("45212310"). Among a few throws (the random one, the
   * drift flipped, lifted one or two digit heights, shifted sideways) the new number takes the one whose box keeps the
   * least area in common with the live numbers' boxes, sampled over the next ~0.6 s of both. A number pushed beside the hero
   * (`side`) keeps its side and only lifts. Needs the screen anchor; without it nothing moves. `from` = the age it is placed at
   * (0 for a new number; a number a merge moved is placed again for the rest of its life).
   */
  private place(s: NumberSlot, side: number, from = 0): void {
    if (!(s.ax === s.ax) || this.count === 0) return;
    const nb = this.near;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const o = this.slots[i] as NumberSlot;
      if (o === s || !(o.ax === o.ax)) continue;
      // near by where the numbers are NOW (anchor + their own throw), not by their anchors: a number pushed a whole width sideways
      // sits next to a neighbour its anchor is far from (5454 shifted +300 px and 6387 shifted -300 px landed on each other)
      if (Math.abs(o.ax + o.sx0 - (s.ax + s.sx0)) > 1000 || Math.abs(o.ay + o.sy0 - (s.ay + s.sy0)) > 420) continue;
      nb[n++] = o;
    }
    if (n === 0) return;
    const fontPx = this.pxPerAtlas * ATLAS_FONT_PX;
    const H = DIGIT_H * fontPx * s.size + 12;
    const W = s.width * this.pxPerAtlas * s.size + 18;
    const bx = s.sx0;
    const by = s.sy0;
    const bd = s.drift;
    const cand = side !== 0 ? THROWS_SIDE : THROWS;
    let best = 0;
    let bestScore = Infinity;
    for (let c = 0; c < cand.length; c++) {
      const [fx, fy, fl] = cand[c] as readonly [number, number, number];
      const sx = bx + (side !== 0 ? side : 1) * fx * W;
      const sy = by + fy * H;
      const dr = bd * fl;
      let score = 0;
      for (let k = 0; k < SPACING_T.length; k++) {
        const dt = SPACING_T[k] as number;
        if (from + dt >= s.life) break;
        this.boxAt(s, from + dt, sx, sy, dr);
        const cx = BOX[0] as number;
        const cy = BOX[1] as number;
        const hw = BOX[2] as number;
        const hh = BOX[3] as number;
        for (let j = 0; j < n; j++) {
          const o = nb[j] as NumberSlot;
          const oa = o.age + dt;
          if (oa >= o.life) continue;
          this.boxAt(o, oa, o.sx0, o.sy0, o.drift);
          const ox = Math.min(cx + hw, (BOX[0] as number) + (BOX[2] as number)) - Math.max(cx - hw, (BOX[0] as number) - (BOX[2] as number));
          const oy = Math.min(cy + hh, (BOX[1] as number) + (BOX[3] as number)) - Math.max(cy - hh, (BOX[1] as number) - (BOX[3] as number));
          if (ox > 0 && oy > 0) score += ((SPACING_W[k] as number) * (ox * oy)) / (4 * hw * hh);
        }
      }
      const free = score < 0.004;
      // a small preference for the unmoved throw: every shift / lift / flip costs a little (the list is sorted by that cost,
      // so the first throw that clears everything is also the cheapest one)
      score += throwCost(cand[c] as readonly [number, number, number]);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
      if (free) break;
    }
    const [fx, fy, fl] = cand[best] as readonly [number, number, number];
    s.sx0 = bx + (side !== 0 ? side : 1) * fx * W;
    s.sy0 = by + fy * H;
    s.drift = bd * fl;
  }
  private readonly near: NumberSlot[] = [];

  private merge(s: NumberSlot, amount: number, crit: boolean, colorHex: string | undefined, x: number, y: number, z: number, side: number, ax: number, ay: number): void {
    s.amount += amount;
    if (amount > s.bestAmount) {
      s.bestAmount = amount;
      if (colorHex !== undefined && !s.crit && isDealt(s.kind)) this.setColours(s, colorHex);
    }
    s.since = 0;
    const hit = s.kind === 'normal' || s.kind === 'status';
    // where the number is drawn before the merge touches it (relative to its anchor)
    const tau0 = s.age / s.life;
    const bx = s.sx0 + driftOffset(tau0, s.drift);
    const by = s.sy0 + arcOffset(tau0, s.crit, s.rise);
    if (crit && !s.crit) {
      this.tally(s, -1);
      s.priority = 4;
      this.tally(s, 1);
      this.applyStyle(s, true, colorHex);
      s.age = 0;
    } else if (s.kind === 'normal' || s.kind === 'player') {
      s.size = this.sizeOf(s);
    }
    s.bump = 0;
    if (hit) {
      // the total hangs near the top of its arc while hits keep coming, with time left to be read after the last one
      if (s.age > MERGE_TAU * s.life) s.age = MERGE_TAU * s.life;
      let dx = 0;
      let dy = 0;
      if (ax === ax && s.ax === s.ax && side === s.side && Math.hypot(ax - s.ax, ay - s.ay) <= 300) {
        // shown at the last hit: move to its anchor, placed again for the rest of the life when it moved far enough to meet a neighbour
        dx = s.ax - ax;
        dy = s.ay - ay;
        s.x = x;
        s.y = y;
        s.z = z;
        s.ax = ax;
        s.ay = ay;
        if (Math.hypot(dx, dy) > 4) this.place(s, side, s.age);
      }
      // ... and GLIDES there: the drawn offset decays over GLIDE_T, no jump (whatever moved it: the anchor, the throw, the set-back)
      const tau1 = s.age / s.life;
      const k = s.ga < GLIDE_T ? 1 - smooth01(s.ga / GLIDE_T) : 0;
      s.glx = s.glx * k + dx + bx - (s.sx0 + driftOffset(tau1, s.drift));
      s.gly = s.gly * k + dy + by - (s.sy0 + arcOffset(tau1, s.crit, s.rise));
      s.ga = 0;
    }
    const text = damageText(s.amount, s.kind, s.crit, this.critSuffix, s.word);
    if (text !== s.text) {
      const oldLen = s.len;
      const g = this.tmpGlyphs;
      const gx = this.tmpGx;
      const nl = layoutText(this.table, text, g, gx);
      if (nl > 0 && this.glyphsInUse - oldLen + nl <= this.glyphCap) {
        s.text = text;
        s.len = nl;
        s.glyphs.set(g);
        s.gx.set(gx);
        s.width = textWidth(this.table, s.glyphs, s.gx, s.len);
        this.glyphsInUse += nl - oldLen;
      }
    }
  }
  private readonly tmpGlyphs = new Uint8Array(MAX_GLYPHS);
  private readonly tmpGx = new Float32Array(MAX_GLYPHS);

  /**
   * The glyph cap's victim for a new number of priority `prio` worth `amount`: a retiring number first, else the weakest of the
   * priorities up to `prio` (worth = amount x life left, so chips and numbers about to go leave first); a number of the same
   * priority only goes for a bigger one. -1 when none.
   */
  private pickVictim(prio: number, amount: number): number {
    let best = -1;
    let bestW = Infinity;
    for (let i = 0; i < this.count; i++) {
      const v = this.slots[i] as NumberSlot;
      if (v.priority > prio) continue;
      const w = v.out < 1 ? -1 : v.amount * (1 - v.age / v.life);
      if (w < bestW && (v.out < 1 || v.priority < prio || amount > w)) {
        best = i;
        bestW = w;
      }
    }
    return best;
  }

  private removeAt(i: number): void {
    const s = this.slots[i] as NumberSlot;
    this.tally(s, -1);
    this.glyphsInUse -= s.len;
    this.release(s);
    this.slots.copyWithin(i, i + 1, this.count);
    this.count--;
  }

  private release(s: NumberSlot): void {
    s.alive = false;
    this.free.push(s);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Glyph atlas (canvas → RGBA8)

const ATLAS_FONT_PX = 104;

const SHEAR = 0.22;
const SCALE_X = 1.32;
/** fill fattening (atlas px per side): the chunky weight, kept small so the counters of 0 / 6 / 8 / 9 / 4 stay OPEN round holes (3.6 pinched them into slits) */
const FAT = 1.8;

const OUTLINE_R = 5.4;
/** hollow words (Miss / Block): the body is the bare glyph, then a black keyline, then the coloured outer band (atlas px) */
const HOLLOW_BODY = 0.5;
const HOLLOW_KEY_R = 2.6;
const HOLLOW_BAND_R = 6.2;
const SHADOW_DY = 4;
const SHADOW_BLUR = 3;
const PAD = Math.ceil(Math.max(FAT + OUTLINE_R, HOLLOW_BODY + HOLLOW_KEY_R + HOLLOW_BAND_R) + SHADOW_DY + SHADOW_BLUR * 2 + 3);
const TRACKING = -1;
const ATLAS_W = 1024;

export interface BuiltAtlas {
  data: Uint8Array;
  width: number;
  height: number;
  table: GlyphTable;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const hollowGlyph = (chars: string, gi: number): boolean => HOLLOW_REAL[chars[gi] as string] !== undefined;

/** the atlas font string: weight 700 at the atlas size */
export function atlasFont(family: string): string {
  return `700 ${ATLAS_FONT_PX}px ${family}`;
}

interface GlyphMasks {
  adv: number;
  /** fill bounding box (work px, inclusive) */
  l: number;
  r: number;
  t: number;
  b: number;
  /** pen origin / baseline in work px */
  x0: number;
  y0: number;
  fill: Float32Array;
  out: Float32Array;
  ring: Float32Array;
  ww: number;
  wh: number;
}

export function buildGlyphAtlas(family: string, chars: string = GLYPH_CHARS): BuiltAtlas {
  const font = atlasFont(family);
  const probe = makeCanvas(8, 8).getContext('2d');
  if (!probe) throw new Error('2D canvas unavailable for the damage-number atlas');
  probe.font = font;
  const WORK = 40;
  const masks: GlyphMasks[] = [];
  for (const ch of chars) {
    const real = HOLLOW_REAL[ch];
    const hollow = real !== undefined;
    const drawCh = real ?? ch;
    const adv = probe.measureText(drawCh).width * SCALE_X;
    const ww = Math.ceil(adv + ATLAS_FONT_PX * 0.6 + 2 * WORK);
    const wh = Math.ceil(ATLAS_FONT_PX * 1.6 + 2 * WORK);
    const x0 = WORK + ATLAS_FONT_PX * 0.14;
    const y0 = WORK + ATLAS_FONT_PX * 1.14;
    const cv = makeCanvas(ww, wh);
    const ctx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    const n = ww * wh;
    const pass = (strokeR: number): Float32Array => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ww, wh);
      // a = widen, c = -shear: the glyph (y up = negative) leans to the right
      ctx.setTransform(SCALE_X, 0, -SHEAR, 1, x0, y0);
      ctx.lineWidth = strokeR * 2;
      ctx.strokeText(drawCh, 0, 0);
      ctx.fillText(drawCh, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const img = ctx.getImageData(0, 0, ww, wh).data;
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = (img[i * 4 + 3] as number) / 255;
      return a;
    };
    // digits / letters: fill, then the crisp near-black outline (B unused). hollow words: pale body, keyline, coloured band
    const fill = pass(hollow ? HOLLOW_BODY : FAT);
    const out = pass(hollow ? HOLLOW_BODY + HOLLOW_KEY_R : FAT + OUTLINE_R);
    const ring = hollow ? pass(HOLLOW_BODY + HOLLOW_KEY_R + HOLLOW_BAND_R) : new Float32Array(n);
    let l = ww;
    let r = -1;
    let tt = wh;
    let bb = -1;
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        if ((fill[y * ww + x] as number) > 0.3) {
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < tt) tt = y;
          if (y > bb) bb = y;
        }
      }
    }
    if (r < l) {
      l = Math.round(x0);
      r = l + 1;
      tt = Math.round(y0) - 2;
      bb = Math.round(y0);
    }
    masks.push({ adv, l, r, t: tt, b: bb, x0, y0, fill, out, ring, ww, wh });
  }

  const sizes = masks.map((m) => ({ w: m.r - m.l + 1 + 2 * PAD, h: m.b - m.t + 1 + 2 * PAD }));
  const packed = packShelves(sizes, ATLAS_W, 4);
  let height = 64;
  while (height < packed.height) height *= 2;
  const data = new Uint8Array(ATLAS_W * height * 4);
  const table = new GlyphTable(chars);
  const zeroIdx = chars.indexOf('0');
  const capH = zeroIdx >= 0 ? masks[zeroIdx]!.y0 - masks[zeroIdx]!.t : ATLAS_FONT_PX * 0.78;

  for (let gi = 0; gi < chars.length; gi++) {
    const m = masks[gi] as GlyphMasks;
    const cw = sizes[gi]!.w;
    const ch2 = sizes[gi]!.h;
    const sx = m.l - PAD;
    const sy = m.t - PAD;
    const n = cw * ch2;
    const crop = (src: Float32Array): Float32Array => {
      const o = new Float32Array(n);
      for (let y = 0; y < ch2; y++) {
        const yy = sy + y;
        if (yy < 0 || yy >= m.wh) continue;
        for (let x = 0; x < cw; x++) {
          const xx = sx + x;
          if (xx >= 0 && xx < m.ww) o[y * cw + x] = src[yy * m.ww + xx] as number;
        }
      }
      return o;
    };
    const fill = crop(m.fill);
    const out = crop(m.out);
    const ring = crop(m.ring);
    // tight drop shadow: the outline silhouette nudged down, blurred
    const tmp = new Float32Array(n);
    const shadow = new Float32Array(n);
    const sil = hollowGlyph(chars, gi) ? ring : out;
    for (let y = SHADOW_DY; y < ch2; y++) for (let x = 0; x < cw; x++) shadow[y * cw + x] = sil[(y - SHADOW_DY) * cw + x] as number;
    boxBlur(shadow, cw, ch2, SHADOW_BLUR, 2, tmp);
    for (let i = 0; i < n; i++) shadow[i] = Math.min(1, (shadow[i] as number) * 1.35);

    const ox = packed.x[gi] as number;
    const oy = packed.y[gi] as number;
    for (let y = 0; y < ch2; y++) {
      let di = ((oy + y) * ATLAS_W + ox) * 4;
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        data[di++] = Math.round((fill[i] as number) * 255);
        data[di++] = Math.round((out[i] as number) * 255);
        data[di++] = Math.round((ring[i] as number) * 255);
        data[di++] = Math.round((shadow[i] as number) * 255);
      }
    }
    const asc = m.y0 - m.t;
    const desc = m.b - m.y0;
    table.adv[gi] = m.adv + TRACKING;
    table.inkX0[gi] = m.l - m.x0;
    table.inkX1[gi] = m.r - m.x0;
    table.cx[gi] = (m.l + m.r) / 2 - m.x0;
    table.cy[gi] = (asc - desc) / 2 - capH / 2;
    table.w[gi] = cw;
    table.h[gi] = ch2;
    table.u0[gi] = ox / ATLAS_W;
    table.u1[gi] = (ox + cw) / ATLAS_W;
    table.v0[gi] = oy / height;
    table.v1[gi] = (oy + ch2) / height;
  }
  return { data, width: ATLAS_W, height, table };
}

// ---------------------------------------------------------------------------------------------------------------
// Shaders

const VERT = /* glsl */ `
attribute vec4 aA; // anchor xyz, number scale
attribute vec4 aB; // screen offset px (x,y), alpha, style
attribute vec4 aC; // glyph centre xy (atlas px), glyph size wh (atlas px)
attribute vec4 aD; // uv rect u0 v0 u1 v1
attribute vec4 aE; // fill rgb (linear, tone-map compensated), element tint amount
attribute vec4 aF; // element tint rgb (linear)
uniform float uWorldPerPx;
uniform float uPxPerAtlas;
uniform float uRefDepth;
uniform float uPersp;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vElem;
varying float vElemAmt;
varying float vAlpha;
varying float vStyle;

void main() {
  vec2 corner = position.xy; // 0..1, y up
  vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
  float depth = max(-mv.z, 1.0);
  float eff = uRefDepth * pow(depth / uRefDepth, uPersp);
  float wpp = uWorldPerPx * eff;
  vec2 local = (aC.xy + (corner - 0.5) * aC.zw) * aA.w * uPxPerAtlas;
  mv.xy += (aB.xy + local) * wpp;
  gl_Position = projectionMatrix * mv;
  vUv = vec2(mix(aD.x, aD.z, corner.x), mix(aD.w, aD.y, corner.y));
  vTint = aE.rgb;
  vElemAmt = aE.w;
  vElem = aF.rgb;
  vAlpha = aB.z;
  vStyle = aB.w;
}
`;

// FLAT fill, crisp near-black outline, tight shadow: no gradient, no bevel, no gloss, no flash, no second band. The element of a
// number we deal only lends a little of its hue to the near-black outline. Hollow words (style 5, Miss / Block) are the one

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uKey; // 0..1: the keyline grows by 0.5 px x uKey over a bright ground; 0 = the atlas stroke as baked
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vElem;
varying float vElemAmt;
varying float vAlpha;
varying float vStyle;

// premultiplied "over"
vec4 over(vec4 s, vec4 d) { return s + d * (1.0 - s.a); }

void main() {
  vec4 g = texture2D(uAtlas, vUv, -0.5);
  float soft = g.a;
  float word = step(4.5, vStyle);
  float player = step(1.5, vStyle) * (1.0 - step(2.5, vStyle));

  vec4 acc = vec4(0.0, 0.0, 0.0, soft * 0.5);
  if (word > 0.5) {
    float bodyM = g.r;
    float keyM = max(g.g, bodyM);
    float bandM = max(g.b, keyM);
    vec3 body = mix(vec3(0.80, 0.74, 0.74), max(vTint, vec3(0.0)), 0.30) * 0.82;
    acc = over(vec4(max(vTint, vec3(0.0)) * bandM, bandM), acc);
    acc = over(vec4(vec3(0.014, 0.004, 0.004) * keyM, keyM), acc);
    acc = over(vec4(body * bodyM, bodyM), acc);
  } else {
    float fillM = g.r;
    float sil = g.g;
    if (uKey > 0.01) {
      // DMG-01: +0.5 px of keyline on a bright ground (the lemon digits lose their edge on grass, sand, snow): the silhouette dilated
      // by half a screen pixel, 4 taps behind a uniform branch
      vec2 o = fwidth(vUv) * (0.5 * uKey);
      float hx = max(texture2D(uAtlas, vUv + vec2(o.x, 0.0), -0.5).g, texture2D(uAtlas, vUv - vec2(o.x, 0.0), -0.5).g);
      float hy = max(texture2D(uAtlas, vUv + vec2(0.0, o.y), -0.5).g, texture2D(uAtlas, vUv - vec2(0.0, o.y), -0.5).g);
      sil = max(sil, max(hx, hy));
    }
    // the stroke mask is filtered (mips, bilinear): a contrast curve keeps its 2 px band crisp and near-black instead of an olive half-tone
    float outM = max(clamp((sil - 0.1) * 1.3, 0.0, 1.0), fillM);
    vec3 outCol = vec3(0.016, 0.011, 0.010) + max(vElem, vec3(0.0)) * (0.06 * vElemAmt);
    outCol = mix(outCol, vec3(0.045, 0.002, 0.004), player);
    acc = over(vec4(outCol * outM, outM), acc);
    // a compensated fill has a NEGATIVE weak channel (it cancels ACES' blue leak at full alpha); while the number fades that
    // negative light would stain the ground with the opposite hue (the fading blue '+12' / red '35' left orange-red ghosts), so
    // the fill eases to its non-negative part below ~0.55 alpha
    vec3 fillCol = mix(max(vTint, vec3(0.0)), vTint, smoothstep(0.55, 1.0, vAlpha));
    acc = over(vec4(fillCol * fillM, fillM), acc);
  }
  acc *= vAlpha;
  if (acc.a < 0.003) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// The crit starburst: one ellipse quad per crit number, drawn under the digits in TWO passes that share the instance buffer: a
// crimson MULTIPLY haze (a per-channel darkening keeps its red on any ground) and the rays + hot centre over it.
const BURST_VERT = /* glsl */ `
attribute vec4 aA; // anchor xyz, burst width px
attribute vec4 aB; // screen offset px (x,y), alpha, ray rotation
attribute vec4 aE; // burst height px, number half width px, number half height px, burst age 0..1
uniform float uWorldPerPx;
uniform float uRefDepth;
uniform float uPersp;
varying vec2 vUv;
varying vec2 vPx;
varying float vAlpha;
varying float vRot;
varying vec3 vNumData;

void main() {
  vec2 c = position.xy - 0.5;
  vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
  float depth = max(-mv.z, 1.0);
  float eff = uRefDepth * pow(depth / uRefDepth, uPersp);
  float wpp = uWorldPerPx * eff;
  vec2 r = c * vec2(aA.w, aE.x);
  mv.xy += (aB.xy + r) * wpp;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vPx = r;
  vAlpha = aB.z;
  vRot = aB.w;
  vNumData = aE.yzw;
}
`;

const BURST_COMMON = /* glsl */ `
uniform sampler2D uBurst;
varying vec2 vUv;
varying vec2 vPx;
varying float vAlpha;
varying float vRot;
varying vec3 vNumData;

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
// the shipped ray mask read twice at two rotations / scales: twice the rays, finer and uneven (the reference star is DENSE)
float rayMask(vec2 p, float lod) {
  float a = sqrt(texture2D(uBurst, rot2(p, vRot) + 0.5, lod).r);
  float b = sqrt(texture2D(uBurst, rot2(p * 1.09, 2.2 - vRot * 0.55) + 0.5, lod).r);
  return clamp(a + 0.72 * b * (1.0 - a), 0.0, 1.0);
}
`;


// centre). Additive light goes pastel peach on snow, so the rays are drawn premultiplied-over with only part of their light as
// alpha (the rest adds), coloured deep red -> red-orange -> amber by ray brightness and brighter toward the centre, and the
// SAME colours on every ground and for every element (no per-element lean: r2 looked dusty pink on some crits, orange on others).
// The hot centre is a glow shaped like the NUMBER (a tight ellipse that dies before the quad edge), so it rims the digits instead
// of hiding behind them.
const BURST_FRAG = /* glsl */ `
uniform vec3 uTip;
uniform vec3 uMid;
uniform vec3 uHot;
uniform vec3 uCore;
${BURST_COMMON}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float edge = 1.0 - smoothstep(0.28, 0.47, r);
  float v = rayMask(p, 0.0);
  float rad = 1.0 - smoothstep(0.0, 0.5, r);
  float t = v * (0.7 + 0.3 * rad);
  vec3 col = mix(uTip, uMid, smoothstep(0.1, 0.55, t));
  col = mix(col, uHot, smoothstep(0.5, 1.0, t) * (0.35 + 0.65 * rad));
  float a = pow(v, 0.9) * edge * vAlpha * 0.95;
  vec3 rgb = col * a;
  float aa = a * 0.78;
  vec2 q = vPx / vec2(vNumData.x * 0.75 + 40.0, vNumData.y * 1.0 + 16.0);
  float core = exp(-dot(q, q) * 1.3) * (1.0 - smoothstep(0.28, 0.46, r)) * vAlpha;
  rgb += uCore * (core * 0.45);
  aa += core * 0.22;
  gl_FragColor = vec4(rgb, min(aa, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// The haze: a per-channel MULTIPLY (dst * colour), so it stays crimson on snow (an alpha-over dark body turned snow into a muddy
// grey-brown smudge) and a dark red on stone / lava. A soft round glow plus the ray mask read from a very coarse mip (no ragged edge).
const BURST_HAZE_FRAG = /* glsl */ `
uniform vec3 uHaze;
${BURST_COMMON}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float edge = 1.0 - smoothstep(0.14, 0.44, r);
  float blur = rayMask(p, 5.5);
  float glow = exp(-r * r * 13.0);
  float h = clamp(0.62 * glow + 1.2 * blur * glow, 0.0, 0.95);
  h = h * h * (3.0 - 2.0 * h) * edge * vAlpha;
  gl_FragColor = vec4(mix(vec3(1.0), uHaze, h), 1.0);
}
`;

/** manifest id of the shipped starburst mask (generated: dense uneven rays on black, our own art) */
export const BURST_SPRITE = 'vfx_damage_numbers_crit_burst';

/**
 * The colours the player should SEE in the burst (the ray ramp is ACES-compensated by `hdrFill`); `haze` is the linear
 * multiplier of the ground under the star at full haze (red survives, green / blue drop: a crimson cast, not a grey smudge).
 */
export const BURST_COLORS = { tip: '#a8100a', mid: '#f03c0a', hot: '#ffa02c', core: '#ffd27a', haze: '#b0160c' } as const;

/** burst ellipse: width = number width x WIDE + PAD (clamped), height = width x ASPECT */
export const BURST_WIDE = 1.55;
export const BURST_PAD = 130;
export const BURST_MIN_W = 250;
export const BURST_MAX_W = 500;
export const BURST_ASPECT = 0.58;

/** Drawn stand-in while the sprite is not loaded (tests, a missing id): a hot core with tapered grey rays. */
function makeFallbackBurst(): CanvasTexture {
  const s = 128;
  const cv = makeCanvas(s, s);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rnd() * 0.2;
    const len = s * (0.22 + rnd() * 0.26);
    const w = 0.03 + rnd() * 0.05;
    const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - w) * 3, Math.sin(a - w) * 3);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(Math.cos(a + w) * 3, Math.sin(a + w) * 3);
    ctx.fill();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.14);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// RenderSystem

const FLOATS_PER_GLYPH = 24;
const FLOATS_PER_BURST = 12;

export class DamageNumbers implements RenderSystem {
  readonly name = 'damageNumbers';
  readonly field: DamageNumberField;
  /** resolves once the bundled face is loaded and the atlas is built from it (dev stage / tests await it) */
  ready: Promise<void> = Promise.resolve();

  private readonly core: RenderCore;
  private fontFamily: string;
  private atlasTex: DataTexture;
  private readonly material: ShaderMaterial;
  private geometry: InstancedBufferGeometry;
  private buffer!: InstancedInterleavedBuffer;
  private data!: Float32Array;
  private mesh: Mesh;
  private cap: number;
  private viewW = 1920;
  private viewH = 1080;
  private readonly unsub: () => void;
  private fontToken = 0;
  // crit starburst batch
  private readonly burstMaterial: ShaderMaterial;
  private readonly hazeMaterial: ShaderMaterial;
  private burstGeometry: InstancedBufferGeometry;
  private burstBuffer!: InstancedInterleavedBuffer;
  private burstData!: Float32Array;
  private readonly burstMesh: Mesh;
  private readonly hazeMesh: Mesh;
  private burstCap: number;
  private readonly burstTex: CanvasTexture;

  constructor(core: RenderCore, opts: DamageNumbersOptions = {}) {
    this.core = core;
    this.fontFamily = opts.fontFamily ?? DAMAGE_DEFAULT_FONT;
    const built = buildGlyphAtlas(this.fontFamily);
    this.atlasTex = this.makeTexture(built);
    this.cap = core.quality.profile.damageGlyphCap;
    this.burstCap = burstCapFor(this.cap);
    this.field = new DamageNumberField({
      glyphCap: this.cap,
      table: built.table,
      rng: opts.rng,
      critSuffix: opts.critSuffix ?? false,
      // one counter per target over a quarter second; the live plain hits and crits are capped per tier (the biggest stay)
      mergeWindow: NUMBER_MERGE_WINDOW,
      lowCap: plainCapFor(this.cap),
      critCap: critCapFor(this.cap),
    });
    this.material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlasTex },
        uWorldPerPx: { value: 0 },
        uPxPerAtlas: { value: 38 / ATLAS_FONT_PX },
        uRefDepth: { value: 22 },
        uPersp: { value: 0.72 },
        uKey: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
    });
    this.geometry = this.makeGeometry(this.cap);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'damageNumbers';
    this.mesh.visible = false;
    core.scene.add(this.mesh);

    this.burstTex = makeFallbackBurst();
    const burstUniforms = (extra: Record<string, { value: unknown }>): Record<string, { value: unknown }> => ({
      uBurst: { value: this.burstTex as Texture },
      uWorldPerPx: { value: 0 },
      uRefDepth: { value: 22 },
      uPersp: { value: 0.72 },
      ...extra,
    });
    this.burstMaterial = new ShaderMaterial({
      uniforms: burstUniforms({
        uTip: { value: new Vector3().fromArray(hdrFill(BURST_COLORS.tip)) },
        uMid: { value: new Vector3().fromArray(hdrFill(BURST_COLORS.mid)) },
        uHot: { value: new Vector3().fromArray(hdrFill(BURST_COLORS.hot)) },
        uCore: { value: new Vector3().fromArray(hdrFill(BURST_COLORS.core)) },
      }),
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // premultiplied over (the rays' own alpha is lower than their light, so part of them adds)
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      side: DoubleSide,
    });
    // the crimson haze under the rays: ground * colour (per channel)
    this.hazeMaterial = new ShaderMaterial({
      uniforms: burstUniforms({ uHaze: { value: new Vector3().fromArray(hexToLinear(BURST_COLORS.haze)) } }),
      vertexShader: BURST_VERT,
      fragmentShader: BURST_HAZE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      side: DoubleSide,
    });
    this.burstGeometry = this.makeBurstGeometry(this.burstCap);
    this.hazeMesh = new Mesh(this.burstGeometry, this.hazeMaterial);
    this.hazeMesh.frustumCulled = false;
    this.hazeMesh.renderOrder = 998;
    this.hazeMesh.name = 'damageNumbers.haze';
    this.hazeMesh.visible = false;
    core.scene.add(this.hazeMesh);
    this.burstMesh = new Mesh(this.burstGeometry, this.burstMaterial);
    this.burstMesh.frustumCulled = false;
    this.burstMesh.renderOrder = 999;
    this.burstMesh.name = 'damageNumbers.burst';
    this.burstMesh.visible = false;
    core.scene.add(this.burstMesh);

    // the first spawn of a run must lay out with the real font size, not the field's default (the spacing is size dependent)
    this.field.pxPerAtlas = this.fontPx / ATLAS_FONT_PX;
    // the live numbers' anchors follow the camera: a merge glides from where its number is drawn now, not from where it was born
    this.field.projector = (x, y, z, out) => {
      const k = clamp(Math.min(this.viewW, this.viewH) / 1080, 0.62, 1.8);
      const ndc = this.ndc.set(x, y, z).project(this.core.camera);
      out[0] = (ndc.x * this.viewW) / 2 / k;
      out[1] = (ndc.y * this.viewH) / 2 / k;
    };

    this.unsub = core.quality.onChange((p) => this.onQuality(p));
    // the bundled face is awaited before the real atlas is built (the first build above uses whatever is available now)
    // the shipped starburst sprite replaces the drawn stand-in as soon as it is loaded; `ready` covers both
    this.ready = Promise.all([this.loadFace(this.fontFamily), this.loadBurst()]).then(() => undefined);
  }

  private burstLoaded = false;
  private async loadBurst(): Promise<void> {
    try {
      const assets = this.core.assets;
      if (!assets.hasTexture(BURST_SPRITE)) return;
      const tex = await assets.loadTexture(BURST_SPRITE);
      this.burstMaterial.uniforms.uBurst!.value = tex;
      this.hazeMaterial.uniforms.uBurst!.value = tex;
      this.burstLoaded = true;
    } catch {
      /* keeps the drawn stand-in */
    }
  }

  /** true once the shipped starburst sprite replaced the drawn stand-in */
  get burstSpriteLoaded(): boolean {
    return this.burstLoaded;
  }

  /** Nominal on-screen font size at 1080 px viewport height (CSS px). */
  fontPx = 44;

  private heroX = 0;
  private heroZ = 0;
  private heroOn = false;

  /** Local hero ground position (keep-out centre); `on` false = no keep-out. Called once per frame. */
  setHero(x: number, z: number, on: boolean): void {
    this.heroX = x;
    this.heroZ = z;
    this.heroOn = on;
  }

  /** the player index of this client's hero (co-op): a hit dealt by another player is a partner's and never takes the hero's places */
  localPlayer = 0;

  spawn(x: number, z: number, amount: number, opts: DamageSpawnOptions = {}): void {
    const mode = settings.value.damageNumbers;
    if (mode === 'off') return;
    const kind = opts.kind ?? 'normal';
    const crit = opts.crit === true;
    if (mode === 'crit' && !(crit || kind === 'player' || kind === 'heal' || kind === 'word')) return;
    if (!this.core.rig.isVisible(x, z, 2.5)) return;
    // Hero keep-out: screen-right is +X at the fixed camera yaw, so a sideways shift in X keeps a number (and its
    // rise) clear of the hero's body. Player damage / heals / words sit at the hero's left shoulder; anything spawned near
    // the hero's column, level with or in front of it (it would rise through the body), is anchored by its inner
    // edge at least KEEP_OUT_X beside the hero.
    let side = 0;
    if (this.heroOn) {
      const dx = x - this.heroX;
      const dz = z - this.heroZ;
      if (kind === 'player' || kind === 'heal' || kind === 'word') {
        if (dx * dx + dz * dz < 4) {
          x = this.heroX - KEEP_OUT_X;
          side = -1;
        }
      } else if (Math.abs(dx) < KEEP_OUT_X + 1.5 && dz > -KEEP_OUT_NORTH && dz < KEEP_OUT_SOUTH) {
        side = dx < 0 ? -1 : 1;
        x = this.heroX + side * Math.max(Math.abs(dx), KEEP_OUT_X);
      }
    }
    const y = this.core.heightAt(x, z) + (opts.height ?? 1.7);
    // the screen anchor (px at the 1080 p reference, y up) lets the field keep neighbouring numbers apart
    const k = clamp(Math.min(this.viewW, this.viewH) / 1080, 0.62, 1.8);
    const ndc = this.ndc.set(x, y, z).project(this.core.camera);
    const ax = (ndc.x * this.viewW) / 2 / k;
    const ay = (ndc.y * this.viewH) / 2 / k;
    // a hit with no owner (or a negative one: the environment) is nobody's partner
    const mine = opts.player === undefined || opts.player < 0 || opts.player === this.localPlayer;
    this.field.critOnly = mode === 'crit';
    this.field.spawn(x, y, z, amount, kind, crit, opts.color, opts.targetId ?? 0, side, opts.word ?? '', Number.isFinite(ax + ay) ? ax : Number.NaN, ay, mine);
  }
  private readonly ndc = new Vector3();

  /** the keyline growth (0..1, x 0.5 px) in force: the brightness proxy of the active biome is its fog colour (linear luma) */
  keylineNow(): number {
    const c = this.core.env?.fog?.color;
    return c ? keylineAmount(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) : 0;
  }

  /** Word bubbles of the hero's side: Miss (evade), Block (absorb), and the xp counter ("+42 XP", merged for a second). */
  spawnText(what: 'evade' | 'block' | 'xp', x: number, z: number, value: number): void {
    if (what === 'xp') {
      if (!(value > 0)) return;
      this.spawn(x, z, Math.max(1, Math.round(value)), { kind: 'xp', targetId: XP_COUNTER_ID, word: t('vfx.xp'), height: 1.3 });
      return;
    }
    const word = wordText(t(what === 'evade' ? 'vfx.miss' : 'vfx.block'), what);
    this.spawn(x, z, 1, { kind: 'word', word, color: WORD_COLORS[what], targetId: WORD_COUNTER_ID + (what === 'evade' ? 0 : 1), height: 2.2 });
  }

  clear(): void {
    this.field.clear();
    this.mesh.visible = false;
    this.burstMesh.visible = false;
    this.hazeMesh.visible = false;
  }

  /** Swaps the atlas font (e.g. once the UI font is loaded). Resolves when the new atlas is live. */
  async setFont(family: string): Promise<void> {
    const token = ++this.fontToken;
    try {
      await document.fonts?.load(atlasFont(family), '0123456789KMB');
    } catch {
      /* system font stacks have nothing to load */
    }
    if (token !== this.fontToken) return;
    this.fontFamily = family;
    const built = buildGlyphAtlas(family);
    const old = this.atlasTex;
    this.atlasTex = this.makeTexture(built);
    this.material.uniforms.uAtlas!.value = this.atlasTex;
    old.dispose();
    this.field.setTable(built.table);
  }

  get activeNumbers(): number {
    return this.field.count;
  }
  get activeGlyphs(): number {
    return this.field.glyphsInUse;
  }

  onResize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  update(dt: number): void {
    const f = this.field;
    f.update(dt);
    const mesh = this.mesh;
    if (f.count === 0) {
      mesh.visible = false;
      this.burstMesh.visible = false;
      this.hazeMesh.visible = false;
      return;
    }
    const cam = this.core.camera;
    // scale by the SHORT side: a portrait phone gets the same relative size as a landscape one
    const short = Math.min(this.viewW, this.viewH);
    const k = clamp(short / 1080, 0.62, 1.8);
    const u = this.material.uniforms;
    const wpp = (2 * Math.tan((cam.fov * Math.PI) / 360) * k) / this.viewH;
    u.uWorldPerPx!.value = wpp;
    u.uPxPerAtlas!.value = this.fontPx / ATLAS_FONT_PX;
    f.pxPerAtlas = this.fontPx / ATLAS_FONT_PX;
    u.uRefDepth!.value = this.core.rig.distance;
    u.uKey!.value = this.keylineNow();
    for (const bu of [this.burstMaterial.uniforms, this.hazeMaterial.uniforms]) {
      bu.uWorldPerPx!.value = wpp;
      bu.uRefDepth!.value = this.core.rig.distance;
    }
    // a number never grows wider than ~40 % of the short side (css px at this k)
    const maxWidthPx = (0.4 * short) / k;

    const table = f.table;
    const pxPerAtlas = this.fontPx / ATLAS_FONT_PX;
    const d = this.data;
    const bd = this.burstData;
    let o = 0;
    let n = 0;
    let bo = 0;
    let nb = 0;
    for (let pass = 0; pass < 2; pass++) {
      const wantTop = pass === 1;
      for (let i = 0; i < f.count; i++) {
        const s = f.slots[i] as NumberSlot;
        if (s.top !== wantTop) continue;
        const tau = s.age / s.life;
        const out = s.out < 1 ? s.out : 1;
        const alpha = fadeAlpha(s.age, s.life, s.crit ? FADE_CRIT : s.chip ? FADE_CHIP : FADE_PLAIN) * out;
        const bumpS = s.bump < 0.14 ? 0.16 * Math.exp(-s.bump * 22) * Math.cos(s.bump * 10) : 0;
        let scale = s.size * popScale(s.age, s.crit) * (1 + bumpS) * endShrink(tau, s.crit) * (0.8 + 0.2 * out);
        const widthPx = s.width * pxPerAtlas * scale;
        if (widthPx > maxWidthPx) scale *= maxWidthPx / widthPx;
        const glide = s.ga < GLIDE_T ? 1 - smooth01(s.ga / GLIDE_T) : 0;
        const sx = s.sx0 + driftOffset(tau, s.drift) + s.glx * glide;
        const sy = s.sy0 + arcOffset(tau, s.crit, s.rise) + s.gly * glide;
        if (s.crit && s.age < BURST_LIFE && nb < this.burstCap) {
          const env = burstEnvelope(s.age);
          // an ellipse wider than the number (rays AND the hot centre must show on every side of the digits, not only above and
          // below): 1.55x the number's width + 140 px across, 0.58 of that tall (the coverage budget: <= 25 % of the frame)
          const numW = s.width * pxPerAtlas * scale;
          const wide = clamp(numW * BURST_WIDE + BURST_PAD, BURST_MIN_W, BURST_MAX_W) * env.scale;
          bd[bo] = s.x;
          bd[bo + 1] = s.y;
          bd[bo + 2] = s.z;
          bd[bo + 3] = wide;
          bd[bo + 4] = sx;
          bd[bo + 5] = sy;
          bd[bo + 6] = env.alpha * out;
          bd[bo + 7] = (s.amount * 0.6180339) % 6.2832 + s.age * 0.5;
          bd[bo + 8] = wide * BURST_ASPECT;
          bd[bo + 9] = 0.5 * numW;
          bd[bo + 10] = 0.5 * DIGIT_H * this.fontPx * scale;
          bd[bo + 11] = s.age / BURST_LIFE;
          bo += FLOATS_PER_BURST;
          nb++;
        }
        for (let j = 0; j < s.len; j++) {
          const gi = s.glyphs[j] as number;
          d[o] = s.x;
          d[o + 1] = s.y;
          d[o + 2] = s.z;
          d[o + 3] = scale;
          d[o + 4] = sx;
          d[o + 5] = sy;
          d[o + 6] = alpha;
          d[o + 7] = s.style;
          d[o + 8] = s.gx[j] as number;
          d[o + 9] = table.cy[gi] as number;
          d[o + 10] = table.w[gi] as number;
          d[o + 11] = table.h[gi] as number;
          d[o + 12] = table.u0[gi] as number;
          d[o + 13] = table.v0[gi] as number;
          d[o + 14] = table.u1[gi] as number;
          d[o + 15] = table.v1[gi] as number;
          d[o + 16] = s.r;
          d[o + 17] = s.g;
          d[o + 18] = s.b;
          d[o + 19] = s.tint;
          d[o + 20] = s.tr;
          d[o + 21] = s.tg;
          d[o + 22] = s.tb;
          d[o + 23] = 0;
          o += FLOATS_PER_GLYPH;
          n++;
        }
      }
    }
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, o);
    this.buffer.needsUpdate = true;
    this.geometry.instanceCount = n;
    mesh.visible = n > 0;
    this.burstBuffer.clearUpdateRanges();
    this.burstBuffer.addUpdateRange(0, bo);
    this.burstBuffer.needsUpdate = true;
    this.burstGeometry.instanceCount = nb;
    this.burstMesh.visible = nb > 0;
    this.hazeMesh.visible = nb > 0;
  }

  dispose(): void {
    this.unsub();
    this.core.scene.remove(this.mesh);
    this.core.scene.remove(this.burstMesh);
    this.core.scene.remove(this.hazeMesh);
    this.geometry.dispose();
    this.burstGeometry.dispose();
    this.material.dispose();
    this.burstMaterial.dispose();
    this.hazeMaterial.dispose();
    this.atlasTex.dispose();
    this.burstTex.dispose();
    this.fontToken++;
  }

  // -------------------------------------------------------------------------------------------------------------

  /** awaits the bundled face, then (re)builds the atlas from it unless the first build already used it */
  private async loadFace(family: string): Promise<void> {
    const font = atlasFont(family);
    let loaded = false;
    try {
      loaded = document.fonts?.check(font, '0') ?? true;
    } catch {
      loaded = true;
    }
    if (loaded) return;
    await this.setFont(family);
  }

  private makeTexture(built: BuiltAtlas): DataTexture {
    const tex = new DataTexture(built.data, built.width, built.height, RGBAFormat, UnsignedByteType);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = Math.min(4, this.core.renderer.capabilities.getMaxAnisotropy());
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.needsUpdate = true;
    return tex;
  }

  private makeGeometry(cap: number): InstancedBufferGeometry {
    const g = new InstancedBufferGeometry();
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setAttribute('position', quad.getAttribute('position'));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(cap * FLOATS_PER_GLYPH);
    this.buffer = new InstancedInterleavedBuffer(this.data, FLOATS_PER_GLYPH, 1);
    this.buffer.setUsage(35048); // DynamicDrawUsage
    const names = ['aA', 'aB', 'aC', 'aD', 'aE', 'aF'];
    for (let i = 0; i < names.length; i++) g.setAttribute(names[i] as string, new InterleavedBufferAttribute(this.buffer, 4, i * 4));
    g.instanceCount = 0;
    quad.dispose();
    return g;
  }

  private makeBurstGeometry(cap: number): InstancedBufferGeometry {
    const g = new InstancedBufferGeometry();
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setAttribute('position', quad.getAttribute('position'));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.burstData = new Float32Array(cap * FLOATS_PER_BURST);
    this.burstBuffer = new InstancedInterleavedBuffer(this.burstData, FLOATS_PER_BURST, 1);
    this.burstBuffer.setUsage(35048);
    // aA = anchor + width, aB = offset / alpha / rotation, aE = height / number half sizes / age (slot 2; aC is unused)
    g.setAttribute('aA', new InterleavedBufferAttribute(this.burstBuffer, 4, 0));
    g.setAttribute('aB', new InterleavedBufferAttribute(this.burstBuffer, 4, 4));
    g.setAttribute('aE', new InterleavedBufferAttribute(this.burstBuffer, 4, 8));
    g.instanceCount = 0;
    quad.dispose();
    return g;
  }

  private onQuality(p: QualityProfile): void {
    if (p.damageGlyphCap === this.cap) return;
    this.cap = p.damageGlyphCap;
    this.field.lowCap = plainCapFor(this.cap);
    this.field.critCap = critCapFor(this.cap);
    this.field.setGlyphCap(this.cap);
    const old = this.geometry;
    this.geometry = this.makeGeometry(this.cap);
    this.mesh.geometry = this.geometry;
    old.dispose();
    this.burstCap = burstCapFor(this.cap);
    const oldB = this.burstGeometry;
    this.burstGeometry = this.makeBurstGeometry(this.burstCap);
    this.burstMesh.geometry = this.burstGeometry;
    this.hazeMesh.geometry = this.burstGeometry;
    oldB.dispose();
  }
}

/** merge ids of the counters that are not an enemy (enemy ids stay far below; the player counter is 1_000_000 + player) */
const XP_COUNTER_ID = 1_000_900;
const WORD_COUNTER_ID = 1_000_910;

/**
 * How much extra keyline (0..1, x 0.5 px) the numbers get over a ground of this brightness. `luma` is the linear luma of the zone's
 * fog colour, the proxy for the lit ground under the numbers: the lemon yellow loses its edge on golden grass, sandstone and snow
 * (Yeonmu 0.52, Seori 0.44, Suryeon 0.30 all get it), not on the dark lava ground (Daeryeol 0.08).
 */
export function keylineAmount(luma: number): number {
  return smooth01((luma - 0.12) / 0.2);
}

/** crit starbursts alive at once: a few per quality tier (each is one instance of a tiny additive batch) */
export function burstCapFor(glyphCap: number): number {
  return clamp(Math.round(glyphCap / 14), 12, 48);
}

/** Letters the hollow words can draw (Miss, Block, Iska, Blok), mixed case; anything else is dropped (accents are flattened). */
export function wordText(raw: string, fallback: 'evade' | 'block'): string {
  const w = raw
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 's')
    .replace(/[Çç]/g, (c) => (c === 'Ç' ? 'C' : 'c'))
    .replace(/[Ğğ]/g, (c) => (c === 'Ğ' ? 'G' : 'g'))
    .replace(/[Öö]/g, (c) => (c === 'Ö' ? 'O' : 'o'))
    .replace(/[Üü]/g, (c) => (c === 'Ü' ? 'U' : 'u'))
    .split('')
    .filter((c) => HOLLOW_LETTERS.includes(c))
    .join('');
  return w.length > 0 ? w : fallback === 'evade' ? 'Miss' : 'Block';
}
