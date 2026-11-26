// Yacha one-handed swords, tiers 0..3: blackened iron, demon-horn guards curving DOWN, flame-orange / magenta glow. 1.0 m.
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import type { SwordSpec } from '../../archetypes/weapon/sword.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const base = { type: 'sword', grip: 'one_hand' as const, hand: 'r' as const, gripY0: -0.085, gripY1: 0.085, gripA: 0.0185, gripB: 0.015, gripTwist: 0 };

const dark = { steel: '#4a4d5c', steelDark: '#0f1017', steelLight: '#aab0c8', edge: '#e8ecf8', iron: '#1d1b23', ironLight: '#5b5668' };
const palT0 = makePal({ ...dark, wrap: '#2a2023', wrapAccent: '#7a1d2a', gold: '#7a5a2a', goldLight: '#d9b36a', goldDark: '#2a1a08' });
const palT1 = makePal({ ...dark, wrap: '#2a1d24', wrapAccent: '#a02440', gold: '#9a6a2e', goldLight: '#f0c070', goldDark: '#2e1a08', rune: '#ff5a3a', lacquer: '#2a0c14' });
const palT2 = makePal({ ...dark, steel: '#565a6e', wrap: '#5a2030', wrapDark: '#1c0810', wrapAccent: '#e0386a', gold: '#b07a30', goldLight: '#ffd080', goldDark: '#341c08', rune: '#ff6a3a', lacquer: '#2c0a18', gem: '#e0306a', gemGlow: '#ff9ab8' });
const palT3 = makePal({ ...dark, steel: '#626782', steelLight: '#c8d0ee', wrap: '#6a2038', wrapDark: '#200812', wrapAccent: '#ff4a7a', gold: '#c88a34', goldLight: '#ffe090', goldDark: '#3a1e08', rune: '#ff7040', lacquer: '#34081a', gem: '#ff3a78', gemGlow: '#ffb0cc' });

const saw = (from: number, to: number, n: number, depth: number) => (t: number): number => {
  if (t < from || t > to) return 1;
  const u = (((t - from) / (to - from)) * n) % 1;
  return 1 - depth * (1 - u);
};
const sawStations = (from: number, to: number, n: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = from + ((to - from) * k) / n;
    out.push(t, t + 0.002 + ((to - from) / n) * 0.9);
  }
  return out;
};

export const yachaSwords: SwordSpec[] = [
  {
    ...base,
    id: 'yacha_sword_t0',
    tier: 0,
    seed: 3101,
    pal: palT0,
    gripZone: Z.wrap,
    guard: { kind: 'horns', y: 0.098, span: 0.085, thick: 0.014, zone: Z.iron, rise: -0.045, depth: 0.022 },
    pommel: { kind: 'spike', r: 0.022, zone: Z.iron },
    habaki: 0.01,
    blade: { length: 0.74, halfW0: 0.032, halfW1: 0.03, halfT0: 0.0055, halfT1: 0.0032, single: true, spineChamfer: 0.004, bevel: 0.4, tipStart: 0.82, tipPow: 0.8, tipZ: -0.012, ricasso: 0.03, steel: { wear: 0.6, polish: 0.4 } },
    tex: 512,
    paint: { goldEngrave: 0.2 },
  },
  {
    ...base,
    id: 'yacha_sword_t1',
    tier: 1,
    seed: 3102,
    pal: palT1,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'horns', y: 0.099, span: 0.105, thick: 0.016, zone: Z.iron, rise: -0.06, depth: 0.026, trim: true },
    pommel: { kind: 'spike', r: 0.026, zone: Z.gold },
    habaki: 0.012,
    tassel: { count: 2, length: 0.09, zone: Z.silk, width: 0.0065 },
    blade: {
      length: 0.76, halfW0: 0.036, halfW1: 0.033, halfT0: 0.0058, halfT1: 0.0034, single: true, spineChamfer: 0.004, bevel: 0.38, tipStart: 0.8, tipPow: 0.85, tipZ: -0.014, ricasso: 0.035,
      backMod: saw(0.2, 0.62, 4, 0.12),
      stations: sawStations(0.2, 0.62, 4),
      fuller: { c: -0.5, hw: 0.13, depth: 0.5, t0: 0.06, t1: 0.7, ramp: 0.05 },
      steel: { wear: 0.4, polish: 0.6, etch: 0.2 },
    },
    tex: 512,
    paint: { goldEngrave: 0.4 },
  },
  {
    ...base,
    id: 'yacha_sword_t2',
    tier: 2,
    seed: 3103,
    pal: palT2,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'horns', y: 0.1, span: 0.12, thick: 0.018, zone: Z.gold, rise: -0.07, depth: 0.028, gem: true },
    pommel: { kind: 'spike', r: 0.03, zone: Z.gold, gem: true },
    habaki: 0.014,
    tassel: { count: 2, length: 0.11, zone: Z.silk, width: 0.0065 },
    blade: {
      length: 0.78, halfW0: 0.04, halfW1: 0.036, halfT0: 0.006, halfT1: 0.0036, bevel: 0.3, tipStart: 0.8, tipPow: 0.95, ricasso: 0.04,
      backMod: saw(0.3, 0.7, 3, 0.18),
      stations: sawStations(0.3, 0.7, 3),
      fuller: { hw: 0.2, depth: 0.6, t0: 0.05, t1: 0.72, ramp: 0.05 },
      steel: { wear: 0.2, polish: 0.75, etch: 0.35, runes: { t0: 0.12, t1: 0.66, pitch: 0.09, width: 0.014 } },
    },
    tex: 1024,
    emissive: 256,
    paint: { goldEngrave: 0.6 },
  },
  {
    ...base,
    id: 'yacha_sword_t3',
    tier: 3,
    seed: 3104,
    pal: palT3,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'horns', y: 0.102, span: 0.135, thick: 0.02, zone: Z.gold, rise: -0.085, depth: 0.03, gem: true },
    pommel: { kind: 'spike', r: 0.034, zone: Z.gold, gem: true },
    habaki: 0.016,
    tassel: { count: 2, length: 0.13, zone: Z.silk, width: 0.0065 },
    blade: {
      length: 0.82, halfW0: 0.054, halfW1: 0.046, halfT0: 0.0068, halfT1: 0.004, bevel: 0.24, tipStart: 0.78, tipPow: 1.0, ricasso: 0.045,
      belly: { at: 0.4, amount: 0.1, sigma: 0.2 },
      backMod: saw(0.25, 0.72, 3, 0.2),
      stations: sawStations(0.25, 0.72, 3),
      fuller: { hw: 0.22, depth: 0.65, t0: 0.04, t1: 0.76, ramp: 0.05 },
      steel: { wear: 0.05, polish: 0.85, etch: 0.4, inlay: { s: 0.66, w: 0.002 }, runes: { t0: 0.1, t1: 0.72, pitch: 0.09, width: 0.016 } },
    },
    tex: 1024,
    emissive: 512,
    paint: { goldEngrave: 0.8 },
  },
];
