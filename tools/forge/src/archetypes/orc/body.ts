// Extra orc anatomy for `hooks.afterBody`: trapezius hump, belly, clawed hands and feet, spinal ridge. The humanoid nude body is
// reshaped by `build` multipliers; these add the parts a multiplier cannot (claws, hump, paunch).
import { type Vec3, vadd, vnorm, vscale, vsub } from '../../core/math.ts';
import { Ellipsoid } from '../../core/sdf/primitives.ts';
import type { Ctx } from '../humanoid/index.ts';
import { el, rc, spike } from './kit.ts';

export interface OrcBodyOpts {
  /** trapezius / upper-back hump size (0 = none) */
  hump?: number;
  /** belly size (0 = none) */
  belly?: number;
  /** finger claws (length multiplier, 0 = none) */
  claws?: number;
  /** toe claws (length multiplier, 0 = none) */
  toeClaws?: number;
  /** ridge of bony spikes down the spine */
  ridge?: number;
  /** thicker neck mass */
  neckMass?: number;
}

export function orcBody(o: OrcBodyOpts = {}): (ctx: Ctx) => void {
  return (ctx) => {
    const a = ctx.a;
    const s = a.s;
    const SK = (...t: string[]): { tags: string[] } => ({ tags: ['skin', ...t] });
    if ((o.hump ?? 0) > 0) {
      const h = o.hump!;
      const c: Vec3 = [0, a.neck[1] - 0.005 * s, a.neck[2] - 0.075 * s];
      ctx.add('hump', el(c, [0.13 * s * h, 0.075 * s * h, 0.1 * s * h]), 'chest', { ...SK('back', 'trap'), w: 0.05 });
      ctx.add('humpL', el([0.07 * s, c[1] - 0.03 * s, c[2] + 0.01 * s], [0.085 * s * h, 0.06 * s, 0.085 * s]), 'chest', { ...SK('back', 'trap'), w: 0.04 });
      ctx.add('humpR', el([-0.07 * s, c[1] - 0.03 * s, c[2] + 0.01 * s], [0.085 * s * h, 0.06 * s, 0.085 * s]), 'chest', { ...SK('back', 'trap'), w: 0.04 });
    }
    if ((o.neckMass ?? 0) > 0) {
      const k = o.neckMass!;
      ctx.add('neckMass', rc([0, a.neck[1] - 0.02 * s, a.neck[2] - 0.01 * s], [0, a.head[1] + 0.005 * s, a.head[2] - 0.012 * s], a.r.neck * 1.25 * k, a.r.neck * 1.05 * k), 'neck', { ...SK('neck'), w: 0.03 });
    }
    if ((o.belly ?? 0) > 0) {
      const b = o.belly!;
      ctx.add('belly', el([0, a.spine[1] - 0.025 * s, a.spine[2] + 0.07 * s], [0.18 * s * b, 0.13 * s * b, 0.12 * s * b]), 'spine', { ...SK('torso'), w: 0.06 });
    }
    if ((o.ridge ?? 0) > 0) {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const y = a.neck[1] - 0.03 * s - i * 0.06 * s;
        const z = a.spineZ(y) - (0.115 - 0.004 * i) * s;
        ctx.late(`ridge${i}`, spike([0, y, z], [0, y + 0.015 * s, z - 0.05 * s * (1 - i * 0.1) * o.ridge!], 0.017 * s * (1 - 0.05 * i), 0.004 * s), i < 2 ? 'chest' : 'spine', { tags: ['skin', 'claw'], w: 0.004 });
      }
    }
    // claws: finger claws curve out of the fist mitten, toe claws out of the toes
    if ((o.claws ?? 0) > 0) {
      const k = o.claws!;
      for (const sx of [1, -1] as const) {
        const n = sx === 1 ? 'l' : 'r';
        const j = a.side(sx);
        const dir = vnorm(vsub(j.fingerTip, j.wrist));
        for (let f = 0; f < 4; f++) {
          const off = (f - 1.5) * a.r.palmW * 0.45;
          const base = vadd(vadd(j.fingerTip, vscale(dir, -0.02 * s)), [0, 0, off] as Vec3);
          const tip = vadd(vadd(base, vscale(dir, 0.045 * s * k)), [sx * 0.006 * s, 0, 0.004 * s * (f - 1.5) * 0.4] as Vec3);
          ctx.late(`claw${f}_${n}`, spike(base, tip, 0.0085 * s, 0.0016 * s), `fingers_${n}`, { tags: ['claw'], w: 0.002 });
        }
      }
    }
    if ((o.toeClaws ?? 0) > 0) {
      const k = o.toeClaws!;
      for (const sx of [1, -1] as const) {
        const n = sx === 1 ? 'l' : 'r';
        const j = a.side(sx);
        for (let f = 0; f < 3; f++) {
          const off = (f - 1) * a.r.footW * 0.55;
          const base: Vec3 = [j.toeTip[0] + off, 0.018 * s, j.toeTip[2] - 0.012 * s];
          const tip: Vec3 = [base[0] + off * 0.25, 0.01 * s, base[2] + 0.055 * s * k];
          ctx.late(`toeClaw${f}_${n}`, spike(base, tip, 0.011 * s, 0.002 * s), `toe_${n}`, { tags: ['claw'], w: 0.002 });
        }
        // splayed outer toe
        ctx.add(`toeSplay_${n}`, new Ellipsoid([j.ball[0] + sx * a.r.footW * 0.7, 0.026 * s, j.ball[2] + 0.04 * s], [a.r.footW * 0.5, 0.02 * s, 0.05 * s]), `toe_${n}`, { tags: ['skin', 'foot', 'toes'], w: 0.012 });
      }
    }
  };
}
