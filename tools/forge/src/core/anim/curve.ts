// Time-envelope helpers for authoring attack / hit / death / spawn style clips.
import { clamp01 } from '../math.ts';

export type Ease = 'smooth' | 'linear' | 'in' | 'out' | 'inout3';

const apply = (e: Ease, t: number): number => {
  switch (e) {
    case 'linear': return t;
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'inout3': return t * t * t * (t * (t * 6 - 15) + 10);
    default: return t * t * (3 - 2 * t);
  }
};

/** piecewise value curve through [time, value] keys with per-segment easing (clamped outside the key range) */
export function keyed(t: number, keys: readonly (readonly [number, number])[], ease: Ease = 'smooth'): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  const last = keys[keys.length - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t <= b[0]) return a[1] + (b[1] - a[1]) * apply(ease, clamp01((t - a[0]) / (b[0] - a[0] || 1)));
  }
  return last[1];
}

/** 0 -> 1 ramp between t0 and t1 */
export const ramp = (t: number, t0: number, t1: number, ease: Ease = 'smooth'): number => apply(ease, clamp01((t - t0) / (t1 - t0 || 1)));

/** bump: rises over [t0,t1], holds to t2, falls over [t2,t3] */
export const bump = (t: number, t0: number, t1: number, t2: number, t3: number, ease: Ease = 'smooth'): number => ramp(t, t0, t1, ease) * (1 - ramp(t, t2, t3, ease));

/** damped oscillation (impact reactions): amplitude 1 at t=0 decaying with rate k, frequency f (Hz) */
export const damped = (t: number, f: number, k: number): number => Math.exp(-k * t) * Math.cos(2 * Math.PI * f * t);
