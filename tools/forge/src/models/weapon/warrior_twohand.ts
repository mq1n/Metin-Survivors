// Warrior two-handed greatswords, tiers 0..3 (1.5 m). Rear hand at the origin, front hand 0.21 m up the grip (handL).
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import type { SwordSpec } from '../../archetypes/weapon/sword.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const base = { type: 'twohand', grip: 'two_hand' as const, hand: 'r' as const, gripY0: -0.1, gripY1: 0.3, gripA: 0.0205, gripB: 0.0165, gripTwist: 0, handL: 0.21 };

const palT0 = makePal({ steel: '#66717f', steelDark: '#1b222e', steelLight: '#c2cdd9', iron: '#383b43', wrap: '#4a3226', wrapAccent: '#8a2a22' });
const palT1 = makePal({ steel: '#727e8c', steelDark: '#1e2735', steelLight: '#cdd9e6', gold: '#b58429', iron: '#3d404a', wrap: '#5a2a24', wrapAccent: '#c12a2a', silk: '#b3222a' });
const palT2 = makePal({ steel: '#7d8b9d', steelDark: '#1b2537', steelLight: '#dae5f1', gold: '#cd9830', goldLight: '#ffe08a', iron: '#444753', lacquer: '#8e1a1f', wrap: '#7a1d22', wrapAccent: '#f0c35a', silk: '#c0262e', rune: '#ffd36a', gem: '#ff7a2a', gemGlow: '#ffe08a' });
const palT3 = makePal({ steel: '#8a9bb0', steelDark: '#16213a', steelLight: '#ffffff', gold: '#e0a92f', goldDark: '#5a3408', goldLight: '#fff0a8', iron: '#25272f', lacquer: '#7c1018', wrap: '#6f141a', wrapAccent: '#ffd66b', silk: '#cf2a30', gem: '#ff8a28', gemGlow: '#ffe08a', rune: '#ffc04d' });

/** sawtooth edge: width multiplier that ramps up over each tooth and drops sharply at its end */
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

export const warriorTwohands: SwordSpec[] = [
  {
    ...base,
    id: 'warrior_twohand_t0',
    tier: 0,
    seed: 2101,
    pal: palT0,
    gripZone: Z.wrap,
    guard: { kind: 'disc', y: 0.317, span: 0.095, thick: 0.016, zone: Z.iron },
    pommel: { kind: 'cap', r: 0.03, zone: Z.iron },
    habaki: 0.012,
    boss: [0.02, 0.016, 0.028],
    blade: {
      length: 1.0, halfW0: 0.05, halfW1: 0.047, halfT0: 0.0062, halfT1: 0.0038, bevel: 0.3, tipStart: 0.86, tipPow: 0.8, ricasso: 0.04,
      fuller: { hw: 0.16, depth: 0.5, t0: 0.05, t1: 0.7, ramp: 0.05 },
      steel: { wear: 0.5, polish: 0.4 },
    },
    tex: 512,
    paint: { goldEngrave: 0.2 },
  },
  {
    ...base,
    id: 'warrior_twohand_t1',
    tier: 1,
    seed: 2102,
    pal: palT1,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'crossUp', y: 0.318, span: 0.13, thick: 0.012, zone: Z.iron, rise: 0.06, knobs: true, depth: 0.036 },
    pommel: { kind: 'disc', r: 0.034, zone: Z.gold },
    habaki: 0.014,
    tassel: { count: 2, length: 0.09, zone: Z.silk, width: 0.0075 },
    boss: [0.022, 0.017, 0.03],
    blade: {
      length: 1.02, halfW0: 0.064, halfW1: 0.056, halfT0: 0.0085, halfT1: 0.0048, single: true, spineChamfer: 0.006, bevel: 0.26, bend: 0.045, bendPow: 1.8, tipStart: 0.84, tipPow: 0.8, tipZ: -0.012, ricasso: 0.045,
      belly: { at: 0.7, amount: 0.12, sigma: 0.16 },
      fuller: { c: -0.5, hw: 0.12, depth: 0.5, t0: 0.06, t1: 0.74, ramp: 0.05 },
      steel: { wear: 0.3, polish: 0.7, hamon: true },
    },
    tex: 512,
    paint: { goldEngrave: 0.4 },
  },
  {
    ...base,
    id: 'warrior_twohand_t2',
    tier: 2,
    seed: 2103,
    pal: palT2,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'horns', y: 0.32, span: 0.13, thick: 0.02, zone: Z.gold, rise: 0.09, depth: 0.03, gem: true },
    pommel: { kind: 'lotus', r: 0.04, zone: Z.gold },
    habaki: 0.016,
    tassel: { count: 2, length: 0.11, zone: Z.silk, width: 0.0075 },
    boss: [0.022, 0.017, 0.03],
    blade: {
      length: 1.04, halfW0: 0.074, halfW1: 0.062, halfT0: 0.0088, halfT1: 0.005, bevel: 0.2, tipStart: 0.82, tipPow: 0.9, ricasso: 0.05,
      belly: { at: 0.45, amount: 0.07, sigma: 0.22 },
      edgeMod: saw(0.3, 0.74, 4, 0.1),
      stations: sawStations(0.3, 0.74, 4),
      fuller: { hw: 0.2, depth: 0.6, t0: 0.05, t1: 0.78, ramp: 0.05 },
      steel: { wear: 0.15, polish: 0.8, etch: 0.3, inlay: { s: 0.64, w: 0.002 }, runes: { t0: 0.1, t1: 0.74, pitch: 0.045, width: 0.017 } },
    },
    tex: 1024,
    emissive: 256,
    paint: { goldEngrave: 0.6 },
  },
  {
    ...base,
    id: 'warrior_twohand_t3',
    tier: 3,
    seed: 2104,
    pal: palT3,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'horns', y: 0.322, span: 0.19, thick: 0.028, zone: Z.gold, rise: 0.15, depth: 0.04, gem: true },
    pommel: { kind: 'lotus', r: 0.044, zone: Z.gold, gem: true },
    habaki: 0.018,
    tassel: { count: 2, length: 0.13, zone: Z.silk, width: 0.0075 },
    boss: [0.024, 0.019, 0.034],
    blade: {
      length: 1.08, halfW0: 0.086, halfW1: 0.07, halfT0: 0.0098, halfT1: 0.0056, bevel: 0.18, tipStart: 0.8, tipPow: 1.0, ricasso: 0.055,
      belly: { at: 0.4, amount: 0.1, sigma: 0.22 },
      edgeMod: saw(0.26, 0.72, 4, 0.11),
      backMod: saw(0.26, 0.72, 4, 0.11),
      stations: sawStations(0.26, 0.72, 4),
      fuller: { hw: 0.22, depth: 0.65, t0: 0.04, t1: 0.8, ramp: 0.05 },
      steel: { wear: 0.05, polish: 0.9, etch: 0.35, inlay: { s: 0.68, w: 0.0024 }, runes: { t0: 0.1, t1: 0.78, pitch: 0.05, width: 0.02 } },
    },
    tex: 1024,
    emissive: 512,
    paint: { goldEngrave: 0.8 },
  },
];
