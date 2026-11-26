// Warrior one-handed swords, tiers 0..3 (t0 plain iron -> t3 ornate gold-inlaid dragon blade). Canonical weapon frame, see archetypes/weapon/frame.ts.
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import type { SwordSpec } from '../../archetypes/weapon/sword.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const base = { type: 'sword', grip: 'one_hand' as const, hand: 'r' as const, gripY0: -0.085, gripY1: 0.085, gripA: 0.0195, gripB: 0.0155, gripTwist: 0 };

const palT0 = makePal({ steel: '#68727f', steelDark: '#1c2330', steelLight: '#c4cfdb', iron: '#3a3d45', wrap: '#4b3326', wrapAccent: '#8a2a22' });
const palT1 = makePal({ steel: '#74808e', steelDark: '#1f2836', steelLight: '#d0dce9', gold: '#b98a2c', iron: '#3f424c', wrap: '#5b2a24', wrapAccent: '#c12a2a', silk: '#b3222a' });
const palT2 = makePal({ steel: '#7f8d9f', steelDark: '#1c2638', steelLight: '#dbe6f2', gold: '#cf9a30', goldLight: '#ffe08a', iron: '#464955', lacquer: '#8e1a1f', wrap: '#7a1d22', wrapAccent: '#f0c35a', silk: '#c0262e', jade: '#47b98a', rune: '#ffd36a', gem: '#ff7a2a', gemGlow: '#ffe08a' });
const palT3 = makePal({ steel: '#8c9db1', steelDark: '#18233a', steelLight: '#ffffff', gold: '#e0a92f', goldDark: '#5a3408', goldLight: '#fff0a8', iron: '#25272f', lacquer: '#7c1018', wrap: '#6f141a', wrapAccent: '#ffd66b', silk: '#cf2a30', gem: '#ff8a28', gemGlow: '#ffe08a', jade: '#47b98a', rune: '#ffc04d' });

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

export const warriorSwords: SwordSpec[] = [
  {
    ...base,
    id: 'warrior_sword_t0',
    tier: 0,
    seed: 1101,
    pal: palT0,
    gripZone: Z.wrap,
    guard: { kind: 'disc', y: 0.097, span: 0.075, thick: 0.014, zone: Z.iron },
    pommel: { kind: 'cap', r: 0.026, zone: Z.iron },
    habaki: 0.01,
    blade: { length: 0.74, halfW0: 0.04, halfW1: 0.034, halfT0: 0.0058, halfT1: 0.0034, single: true, spineChamfer: 0.004, bevel: 0.34, tipStart: 0.8, tipPow: 0.8, tipZ: -0.016, ricasso: 0.03, belly: { at: 0.62, amount: 0.1, sigma: 0.16 }, steel: { wear: 0.5, polish: 0.4, hamon: true } },
    tex: 512,
    paint: { goldEngrave: 0.2, wrapDiamond: true },
  },
  {
    ...base,
    id: 'warrior_sword_t1',
    tier: 1,
    seed: 1102,
    pal: palT1,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'crossUp', y: 0.099, span: 0.115, thick: 0.01, zone: Z.iron, rise: 0.05, knobs: true, depth: 0.032 },
    pommel: { kind: 'disc', r: 0.03, zone: Z.gold },
    habaki: 0.012,
    tassel: { count: 3, length: 0.1, zone: Z.silk, width: 0.011 },
    blade: {
      length: 0.76, halfW0: 0.041, halfW1: 0.036, halfT0: 0.0052, halfT1: 0.0032, bevel: 0.24, tipStart: 0.8, tipPow: 0.9, ricasso: 0.035,
      belly: { at: 0.5, amount: 0.16, sigma: 0.2 },
      fuller: { hw: 0.2, depth: 0.55, t0: 0.05, t1: 0.66, ramp: 0.05 },
      steel: { wear: 0.3, polish: 0.7, etch: 0.2 },
    },
    tex: 512,
    paint: { goldEngrave: 0.4 },
  },
  {
    ...base,
    id: 'warrior_sword_t2',
    tier: 2,
    seed: 1103,
    pal: palT2,
    gripZone: Z.lacquer,
    collars: true,
    guard: { kind: 'horns', y: 0.1, span: 0.115, thick: 0.017, zone: Z.gold, rise: 0.075, depth: 0.026, gem: true },
    pommel: { kind: 'lotus', r: 0.036, zone: Z.gold },
    habaki: 0.014,
    tassel: { count: 3, length: 0.12, zone: Z.silk, width: 0.012 },
    blade: {
      length: 0.77, halfW0: 0.045, halfW1: 0.039, halfT0: 0.0056, halfT1: 0.0034, bevel: 0.22, tipStart: 0.78, tipPow: 0.95, ricasso: 0.04,
      belly: { at: 0.5, amount: 0.07, sigma: 0.22 },
      edgeMod: (t: number): number => (t < 0.15 ? 1.16 : 1),
      backMod: (t: number): number => (t < 0.15 ? 1.16 : 1),
      stations: [0.148, 0.152],
      fuller: { hw: 0.22, depth: 0.6, t0: 0.05, t1: 0.7, ramp: 0.05 },
      steel: { wear: 0.15, polish: 0.8, etch: 0.3, inlay: { s: 0.62, w: 0.0018 }, runes: { t0: 0.12, t1: 0.62, pitch: 0.05, width: 0.013 } },
    },
    tex: 1024,
    emissive: 256,
    paint: { goldEngrave: 0.6 },
  },
  {
    ...base,
    id: 'warrior_sword_t3',
    tier: 3,
    seed: 1104,
    pal: palT3,
    gripZone: Z.lacquer,
    collars: true,
    guard: { kind: 'horns', y: 0.102, span: 0.14, thick: 0.02, zone: Z.gold, rise: 0.12, depth: 0.03, gem: true },
    pommel: { kind: 'lotus', r: 0.04, zone: Z.gold, gem: true },
    habaki: 0.016,
    tassel: { count: 3, length: 0.13, zone: Z.silk, width: 0.013 },
    blade: {
      length: 0.8, halfW0: 0.051, halfW1: 0.044, halfT0: 0.006, halfT1: 0.0036, bevel: 0.2, tipStart: 0.76, tipPow: 1.0, ricasso: 0.045,
      belly: { at: 0.45, amount: 0.08, sigma: 0.22 },
      edgeMod: saw(0.3, 0.7, 3, 0.1),
      backMod: saw(0.3, 0.7, 3, 0.1),
      stations: sawStations(0.3, 0.7, 3),
      fuller: { hw: 0.24, depth: 0.65, t0: 0.04, t1: 0.74, ramp: 0.05 },
      steel: { wear: 0.05, polish: 0.9, etch: 0.35, inlay: { s: 0.66, w: 0.002 }, runes: { t0: 0.1, t1: 0.7, pitch: 0.055, width: 0.015 } },
    },
    tex: 1024,
    emissive: 512,
    paint: { goldEngrave: 0.8 },
  },
];
