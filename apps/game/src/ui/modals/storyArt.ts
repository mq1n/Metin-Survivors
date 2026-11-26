// Pure helpers of the story dialog (owner: B9 story): rune tinting of the painted stone, the engraved floor sigil of a metin
// (an invented glyph ring per metin id, never a script), the camera fit of the boss stage and the word split of the ink-in
// reveal. No DOM, no three: unit-tested in storyArt.test.ts.

/** FNV-1a 32 bit hash of a string (stable seed per id). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RuneTint {
  /** `#rrggbb` (normalised, lower case) */
  hex: string;
  /** hue-rotate in degrees that turns the painted orange stone (hue ~28) into this hue */
  rot: number;
  /** saturate() factor */
  sat: number;
  /** brightness() factor */
  bri: number;
  /** readable text colour on top of the rune colour */
  on: string;
}

/**
 * `#rrggbb` -> filter numbers that recolour the painted (orange) stone art. Unlike a plain hue rotation the saturation and the
 * brightness follow the colour, so a pale rune (death, #b8f0c8) reads as a bone-white glow and a strong one (jealousy, #3cd08a)
 * as a deep green instead of two near-identical greens.
 */
export function runeTint(input: string | null | undefined): RuneTint {
  const m = /^#?([0-9a-f]{6})$/i.exec(input ?? '');
  const hex = m ? (m[1] as string).toLowerCase() : 'ff9a2e';
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sHsv = max === 0 ? 0 : d / max;
  const l = (max + min) / 2;
  const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  return {
    hex: `#${hex}`,
    rot: Math.round(h - 28),
    sat: Number(clamp(0.2 + sHsv * 1.05, 0.3, 1.2).toFixed(2)),
    bri: Number(clamp(0.78 + (max - 0.55) * 1.1, 0.82, 1.3).toFixed(2)),
    on: l > 0.58 ? '#1a0a04' : '#fff7e0',
  };
}

/** `#rrggbb` mixed towards another `#rrggbb` (t = share of `b`); a plain hex so contrast probes and old engines see a real colour. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (s: string): [number, number, number] => {
    const n = parseInt(s.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const pa = p(a);
  const pb = p(b);
  const k = Math.min(1, Math.max(0, t));
  const h = (i: 0 | 1 | 2): string => Math.round(pa[i] + (pb[i] - pa[i]) * k).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

export interface Sigil {
  /** broken outer ring arcs (SVG path data, viewBox -50..50) */
  arcs: string[];
  /** short radial ticks around the ring */
  ticks: string;
  /** the glyph strokes between the nodes */
  strokes: string;
  /** node dots */
  nodes: readonly [number, number][];
  /** extra inner ring radius for the great metins (0 = none) */
  inner: number;
}

const f1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const polar = (r: number, deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

/**
 * The engraved floor sigil of one metin: an invented glyph ring (node-and-stroke figure inside a broken ring), derived only from
 * the id so every stone has its own and the same stone always has the same one. `great` metins get a second ring and more nodes.
 */
export function sigilOf(id: string, great = false): Sigil {
  const rand = rng(hash32(`sigil:${id}`));
  const n = (great ? 7 : 5) + Math.floor(rand() * 3);
  const phase = Math.floor(rand() * 360);
  const R = 27;
  const nodes: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = polar(R * (0.86 + rand() * 0.14), phase + (360 / n) * i);
    nodes.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  }
  // a walk over the nodes (never the same edge twice) plus a few chords through the centre region
  const used = new Set<string>();
  const edges: [number, number][] = [];
  let at = Math.floor(rand() * n);
  const steps = n + 1 + Math.floor(rand() * 3);
  for (let i = 0; i < steps * 3 && edges.length < steps; i++) {
    const to = (at + 2 + Math.floor(rand() * (n - 3))) % n;
    const key = at < to ? `${at}-${to}` : `${to}-${at}`;
    if (to !== at && !used.has(key)) {
      used.add(key);
      edges.push([at, to]);
      at = to;
    }
  }
  let strokes = edges.map(([a, b]) => `M${nodes[a]?.[0]} ${nodes[a]?.[1]}L${nodes[b]?.[0]} ${nodes[b]?.[1]}`).join('');
  // a small inner figure: a short stroke from the centre toward two of the nodes
  const c1 = Math.floor(rand() * n);
  const c2 = (c1 + 1 + Math.floor(rand() * (n - 1))) % n;
  for (const c of [c1, c2]) {
    const p = nodes[c] as [number, number];
    strokes += `M0 0L${f1(p[0] * 0.38)} ${f1(p[1] * 0.38)}`;
  }
  // broken outer ring
  const arcs: string[] = [];
  const Ro = 44;
  const pieces = 3 + Math.floor(rand() * 3);
  const gap = 10 + rand() * 8;
  const base = rand() * 360;
  for (let i = 0; i < pieces; i++) {
    const a0 = base + (360 / pieces) * i + gap / 2;
    const a1 = base + (360 / pieces) * (i + 1) - gap / 2;
    const s = polar(Ro, a0);
    const e = polar(Ro, a1);
    arcs.push(`M${f1(s[0])} ${f1(s[1])}A${Ro} ${Ro} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(e[0])} ${f1(e[1])}`);
  }
  let ticks = '';
  const tickN = 9 + Math.floor(rand() * 7);
  for (let i = 0; i < tickN; i++) {
    const a = base + rand() * 360;
    const a2 = polar(Ro - 3.5, a);
    const b2 = polar(Ro + 3.5, a);
    ticks += `M${f1(a2[0])} ${f1(a2[1])}L${f1(b2[0])} ${f1(b2[1])}`;
  }
  return { arcs, ticks, strokes, nodes, inner: great ? 36 : 0 };
}

/** Distance of a camera (vertical field of view in degrees) that frames a box of height `h` and footprint `w` (the larger of x / z). */
export function fitDistance(h: number, w: number, fovDeg: number, aspect: number): number {
  const half = Math.tan((fovDeg * Math.PI) / 360);
  const byH = h / (2 * half);
  const byW = w / (2 * half * Math.max(0.2, aspect));
  return Math.max(byH, byW) * 1.02 + w * 0.12;
}

/** Splits a paragraph into the words of the ink-in reveal (single spaces; the caller re-inserts them). */
export function inkWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Seconds between two words and the cap of one paragraph's whole reveal. */
export const INK_STEP = 0.032;
export const INK_MAX = 1.1;
export function inkDelay(i: number, total: number): number {
  const step = Math.min(INK_STEP, INK_MAX / Math.max(1, total));
  return Math.round(i * step * 1000) / 1000;
}
