// Pure geometry and deterministic data of the reward modals (no DOM, no UI imports, unit-tested in rewardGeom.test.ts):
// socket placement on the medallion ring, per-metin stone poses, the coin / gem spray particle set, and which cards touch
// which essence sockets.
import type { Card } from '../../sim/types';

/** Small deterministic PRNG (mulberry32), same recipe as UiFx.fxRng. */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Angle (degrees clockwise from 12 o'clock) of socket `i` of `n` on a ring, starting at `start`. */
export function ringAngle(i: number, n: number, start = 0): number {
  return start + (360 / n) * i;
}

/** Centre of a ring socket as a fraction of the ring box (0..1), for the radius `r` (fraction of the box edge). */
export function ringPoint(i: number, n: number, r: number, start = 0): { x: number; y: number } {
  const a = (ringAngle(i, n, start) * Math.PI) / 180;
  return { x: 0.5 + Math.sin(a) * r, y: 0.5 - Math.cos(a) * r };
}

/**
 * The six stone sockets on the medallion: the weapon trio on the upper arc (left to right) and the armor trio on the
 * lower arc (left to right), 60 degrees apart, so the ring reads as two groups of three.
 */
export const STONE_RING_DEG: readonly number[] = [-60, 0, 60, -120, 180, 120];

/**
 * Geometry of the medallion, as fractions of the disc DIAMETER (the box edge = the bronze rim): the sockets sit on one ring
 * track at `ring` (0.385 = 77 % of the radius), each is `socket` wide (14 %: small gems set into the track, not slots piled on
 * the disc) and the engraved track is `track` wide (socket plus a margin). Nothing may overhang the rim or the relief hub:
 * `medallionFits` is the unit-tested rule the CSS tokens (`--ring-r`, `--sk`) are taken from.
 */
export const MED = { ring: 0.385, socket: 0.14, track: 0.16, hub: 0.095, rim: 0.465 } as const;

/** true when every socket of the ring lies inside the rim, clear of the hub and clear of its neighbours (distances in disc diameters). */
export function medallionFits(m: { ring: number; socket: number; hub: number; rim: number } = MED, n = 6): boolean {
  const outer = m.ring + m.socket / 2;
  const inner = m.ring - m.socket / 2;
  const chord = 2 * m.ring * Math.sin(Math.PI / n);
  return outer <= m.rim && inner >= m.hub + m.socket * 0.5 && chord >= m.socket * 1.4;
}

/** Gem colour of each socket rim (decorative, never a state colour: states are pearl / ember / gold). */
export const SOCKET_GEMS: readonly string[] = ['#9a62d8', '#4a86d8', '#3fb8b0', '#46b27a', '#cfc8b6', '#7f7b8c'];

/** Small deterministic hash of a string (FNV-1a), for per-metin variations. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface StoneVariant {
  /** mirror the stone art */
  flip: boolean;
  /** degrees */
  rot: number;
  scale: number;
  /** glow strength multiplier */
  glow: number;
  /** crop offset (percent) */
  shift: number;
}

/** Every metin gets its own pose of the stone painting (no two neighbours look like mirrored twins). */
export function stoneVariant(id: string): StoneVariant {
  const h = hashStr(id);
  const r = rng(h);
  return {
    // never mirrored: every metin has its own painting now and the seal on it reads backwards when flipped
    flip: false,
    rot: Math.round((r() - 0.5) * 9 * 10) / 10,
    scale: Math.round((0.94 + r() * 0.12) * 100) / 100,
    glow: Math.round((0.75 + r() * 0.5) * 100) / 100,
    shift: Math.round((r() - 0.5) * 16),
  };
}


export interface Chip3 {
  kind: 'coin' | 'gem';
  /** launch angle (radians, 0 = right, negative = up) */
  a: number;
  /** launch speed, in canvas heights per second */
  v: number;
  /** tumble speed (rad/s) and phase */
  w: number;
  ph: number;
  /** radius in canvas heights */
  r: number;
  hue: number;
  life: number;
  delay: number;
}

export const GEM_HUES: readonly string[] = ['#e0503f', '#f0b73e', '#4cc98a', '#4a86e8', '#b070e0'];

/** The deterministic particle set of a spray (about 70 % coins, 30 % gems). */
export function sprayParticles(seed: number, count: number): Chip3[] {
  const r = rng(seed);
  const out: Chip3[] = [];
  for (let i = 0; i < count; i++) {
    const coin = r() < 0.7;
    out.push({
      kind: coin ? 'coin' : 'gem',
      a: -Math.PI / 2 + (r() - 0.5) * 2.5,
      v: 0.55 + r() * 0.75,
      w: (r() < 0.5 ? -1 : 1) * (7 + r() * 9),
      ph: r() * Math.PI * 2,
      r: coin ? 0.0125 + r() * 0.008 : 0.011 + r() * 0.007,
      hue: Math.floor(r() * GEM_HUES.length),
      life: 1.5 + r() * 0.7,
      delay: r() * 0.16,
    });
  }
  return out;
}

/** Position of a particle at time `t` seconds after launch, in canvas heights from the origin (y down), plus alpha. */
export function sprayAt(p: Chip3, t: number, gravity = 1.9): { x: number; y: number; alpha: number } | null {
  const tt = t - p.delay;
  if (tt < 0 || tt > p.life) return null;
  const x = Math.cos(p.a) * p.v * tt;
  const y = Math.sin(p.a) * p.v * tt + 0.5 * gravity * tt * tt;
  const fade = Math.min(1, (p.life - tt) / 0.35);
  return { x, y, alpha: Math.max(0, fade) };
}


export type MarkKind = 'free' | 'replace' | 'upgrade';

export interface Mark {
  card: number;
  kind: MarkKind;
}

/** Which cards touch which socket, and how (free slot / replace the item in it / upgrade it). */
export function marksOf(cards: readonly Card[]): { stones: Mark[][]; trinkets: Mark[][] } {
  const stones: Mark[][] = Array.from({ length: 6 }, () => []);
  const trinkets: Mark[][] = Array.from({ length: 3 }, () => []);
  cards.forEach((c, card) => {
    const kind: MarkKind = c.kind === 'stoneUp' || c.kind === 'trinketUp' ? 'upgrade' : c.replaces ? 'replace' : 'free';
    if (c.kind === 'stone' || c.kind === 'stoneUp') stones[c.slot]?.push({ card, kind });
    else if (c.kind === 'trinket' || c.kind === 'trinketUp') trinkets[c.slot]?.push({ card, kind });
  });
  return { stones, trinkets };
}
