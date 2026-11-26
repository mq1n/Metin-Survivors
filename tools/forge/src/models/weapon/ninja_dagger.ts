// Ninja curved daggers (one model; the rig rotates it 180 degrees about hand Z for the off hand), tiers 0..3. X-symmetric geometry.
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import type { SwordSpec } from '../../archetypes/weapon/sword.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const base = { type: 'dagger', grip: 'dual' as const, hand: 'r' as const, gripY0: -0.055, gripY1: 0.055, gripA: 0.0155, gripB: 0.0125, gripTwist: 0, boss: [0.012, 0.01, 0.018] as [number, number, number] };

const dark = { steel: '#6c7a84', steelDark: '#131d24', steelLight: '#cfe0e8', edge: '#f0fbff', iron: '#262b30', ironLight: '#69747c', silk: '#2a8a4a', silkDark: '#0a2a18' };
const palT0 = makePal({ ...dark, wrap: '#2c3a2c', wrapDark: '#101810', wrapAccent: '#6a8a3a', wood: '#4a3020' });
const palT1 = makePal({ ...dark, wrap: '#1f4a34', wrapDark: '#0a1c12', wrapAccent: '#7ad08a', gold: '#a88028', goldLight: '#f0cc70', goldDark: '#3a2406' });
const palT2 = makePal({ ...dark, steel: '#76868f', wrap: '#173f2c', wrapDark: '#08170f', wrapAccent: '#9af0a8', gold: '#c19230', goldLight: '#ffe08a', goldDark: '#40260a', lacquer: '#1a4a2e', rune: '#90ff80', gem: '#38d86a', gemGlow: '#b8ffc4' });
const palT3 = makePal({ ...dark, steel: '#82929c', steelLight: '#ffffff', wrap: '#12382a', wrapDark: '#061410', wrapAccent: '#c0ffb0', gold: '#dca830', goldLight: '#fff0a0', goldDark: '#4a2c0a', lacquer: '#123e28', rune: '#9bff6a', gem: '#7cff3a', gemGlow: '#d8ffb0', jade: '#3fcf86' });

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

export const ninjaDaggers: SwordSpec[] = [
  {
    ...base,
    id: 'ninja_dagger_t0',
    tier: 0,
    seed: 4101,
    pal: palT0,
    gripZone: Z.wrap,
    guard: { kind: 'disc', y: 0.062, span: 0.04, thick: 0.01, zone: Z.iron },
    pommel: { kind: 'cap', r: 0.02, zone: Z.iron, loop: true },
    habaki: 0.006,
    blade: { length: 0.29, halfW0: 0.022, halfW1: 0.02, halfT0: 0.0042, halfT1: 0.0026, single: true, spineChamfer: 0.003, bevel: 0.36, bend: -0.045, bendPow: 1.6, tipStart: 0.78, tipPow: 0.8, tipZ: -0.004, ricasso: 0.02, belly: { at: 0.6, amount: 0.12, sigma: 0.2 }, steel: { wear: 0.5, polish: 0.4 } },
    tex: 512,
    paint: { goldEngrave: 0.2 },
  },
  {
    ...base,
    id: 'ninja_dagger_t1',
    tier: 1,
    seed: 4102,
    pal: palT1,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'crossUp', y: 0.063, span: 0.052, thick: 0.007, zone: Z.iron, rise: 0.022, knobs: true, depth: 0.02 },
    pommel: { kind: 'ball', r: 0.017, zone: Z.gold, loop: true },
    habaki: 0.008,
    blade: {
      length: 0.31, halfW0: 0.025, halfW1: 0.022, halfT0: 0.0046, halfT1: 0.0028, single: true, spineChamfer: 0.003, bevel: 0.32, bend: -0.06, bendPow: 1.5, tipStart: 0.78, tipPow: 0.85, tipZ: -0.005, ricasso: 0.022,
      belly: { at: 0.6, amount: 0.15, sigma: 0.2 },
      fuller: { c: -0.45, hw: 0.14, depth: 0.5, t0: 0.08, t1: 0.7, ramp: 0.06 },
      steel: { wear: 0.35, polish: 0.65, hamon: true },
    },
    tex: 512,
    paint: { goldEngrave: 0.4 },
  },
  {
    ...base,
    id: 'ninja_dagger_t2',
    tier: 2,
    seed: 4103,
    pal: palT2,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'crossUp', y: 0.064, span: 0.06, thick: 0.009, zone: Z.gold, rise: 0.026, knobs: true, depth: 0.022 },
    pommel: { kind: 'ball', r: 0.02, zone: Z.gold, gem: true, loop: true },
    habaki: 0.01,

    blade: {
      length: 0.33, halfW0: 0.026, halfW1: 0.02, halfT0: 0.005, halfT1: 0.003, single: true, spineChamfer: 0.003, bevel: 0.3, bend: 0.075, bendPow: 1.9, tipStart: 0.74, tipPow: 0.9, tipZ: 0.004, ricasso: 0.025,


      fuller: { c: 0.3, hw: 0.14, depth: 0.55, t0: 0.08, t1: 0.7, ramp: 0.06 },
      steel: { wear: 0.2, polish: 0.75, etch: 0.3, runes: { t0: 0.1, t1: 0.62, pitch: 0.06, width: 0.01 } },
    },
    tex: 1024,
    emissive: 256,
    paint: { goldEngrave: 0.6 },
  },
  {
    ...base,
    id: 'ninja_dagger_t3',
    tier: 3,
    seed: 4104,
    pal: palT3,
    gripZone: Z.wrap,
    collars: true,
    guard: { kind: 'crossUp', y: 0.065, span: 0.07, thick: 0.011, zone: Z.gold, rise: 0.034, knobs: true, depth: 0.026 },
    pommel: { kind: 'ball', r: 0.024, zone: Z.gold, gem: true, loop: true },
    habaki: 0.01,

    blade: {
      length: 0.36, halfW0: 0.03, halfW1: 0.024, halfT0: 0.0055, halfT1: 0.0032, bevel: 0.26, bend: -0.07, bendPow: 1.7, tipStart: 0.74, tipPow: 0.95, tipZ: -0.004, ricasso: 0.026,
      belly: { at: 0.55, amount: 0.12, sigma: 0.2 },


      fuller: { hw: 0.2, depth: 0.6, t0: 0.06, t1: 0.74, ramp: 0.06 },
      steel: { wear: 0.05, polish: 0.85, etch: 0.35, inlay: { s: 0.66, w: 0.0018 }, runes: { t0: 0.1, t1: 0.7, pitch: 0.06, width: 0.012 } },
    },
    tex: 1024,
    emissive: 512,
    paint: { goldEngrave: 0.8 },
  },
];
