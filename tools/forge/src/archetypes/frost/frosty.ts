// Frost giant bruiser: humanoid body + ice armour (crown, pauldrons, gauntlets, breastplate) + fur boots / loincloth + frozen-wood club.
import { type Vec3, vnorm, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { torsoShell } from '../humanoid/index.ts';
import type { Ctx, Side } from '../humanoid/index.ts';
import { addClub } from './club.ts';
import { Coat, type Ray, spotsOf } from './fur.ts';
import { addBreastplate, addCrown, addGauntlet, addPauldron } from './ice.ts';
import { chunk, orient, surfaceAlong } from './kit.ts';

export interface FrostyOpts {
  /** lock length multiplier */
  furLen?: number;
  club?: boolean;
}

export function frostyBody(opts: FrostyOpts = {}): (ctx: Ctx) => void {
  return (ctx) => {
    const a = ctx.a;
    const s = a.s;
    const rng = new Rng('frost-revenant');
    const sk = ctx.sk;

    // ---- belt: leather band hugging the waist with an ice buckle
    const yb = a.spine[1] - 0.075 * s;
    for (const [i, sh] of torsoShell(a, yb - 0.04 * s, yb + 0.04 * s, 0.016 * s).entries()) {
      ctx.add(`belt_${i}`, sh.sdf, sh.bone, { tags: ['belt'], w: 0.01, grip: 1.3 });
    }

    // ---- ice armour
    addCrown(ctx, rng);
    for (const sx of [1, -1] as Side[]) {
      addPauldron(ctx, rng, sx);
      addGauntlet(ctx, rng, sx);
    }
    addBreastplate(ctx, rng);
    const buckleHit = surfaceAlong(ctx.body.sdf(true), [0, yb, -0.02 * s], [0, 0, 1], 0.5 * s);
    if (buckleHit) {
      const n = ctx.body.sdf(true).grad(buckleHit.p[0], buckleHit.p[1], buckleHit.p[2], 0.012);
      ctx.add('belt_buckle', chunk([buckleHit.p[0] + n[0] * 0.03 * s, buckleHit.p[1], buckleHit.p[2] + n[2] * 0.03 * s], [0.07 * s, 0.055 * s, 0.032 * s], rng, { planes: 9, rot: orient(n) }), 'pelvis', { tags: ['trim'], w: 0.006, grip: 1.6 });
    }

    // ---- fur (needs the body so far as its root surface)
    const base = ctx.body.sdf(true);
    const coat = new Coat(ctx, base, new Rng('frosty-fur'), opts.furLen ?? 1);
    // loincloth: two staggered rings under the belt, split onto the four skirt bones by direction
    if (sk.has('skirt_f')) {
      const skirtBone = (p: Vec3): string => {
        const dx = p[0], dz = p[2] - a.pelvis[2];
        if (Math.abs(dz) >= Math.abs(dx)) return dz >= 0 ? 'skirt_f' : 'skirt_b';
        return dx >= 0 ? 'skirt_l' : 'skirt_r';
      };
      [{ y: yb - 0.045 * s, len: 0.2 * s, c: 18, w: 0.03 * s }, { y: yb - 0.12 * s, len: 0.21 * s, c: 16, w: 0.03 * s }].forEach((row, ri) => {
        const rays: Ray[] = [];
        for (let i = 0; i < row.c; i++) {
          const phi = (Math.PI * 2 * (i + 0.5 + (ri % 2) * 0.5)) / row.c;
          rays.push({ o: [0, row.y, a.pelvis[2]], dir: [Math.sin(phi), 0, Math.cos(phi)] });
        }
        for (const sp of spotsOf(base, rays)) {
          const g = vnorm([sp.n[0] * 0.25, -1, sp.n[2] * 0.25]);
          coat.lock('loin', skirtBone, sp, { dir: g, len: row.len, w: row.w, curl: 0.7, jit: 0.3, tags: ['cloth'] });
        }
      });
    }
    // fur boots: cuff ring under the knee, calf ring, ankle ring, and tufts over the toes
    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      const j = a.side(sx);
      coat.rings(`boot_${n}`, `shin_${n}`, j.knee, j.ankle, sx, [
        { u: 0.16, len: 0.15 * s, w: 0.03 * s }, { u: 0.5, len: 0.17 * s, w: 0.03 * s },
      ], 9, 0.42, 0.7, { curl: 0.6 });
      coat.rings(`ankle_${n}`, `foot_${n}`, vsub(j.ankle, [0, -0.12 * s, 0]), j.ankle, sx, [
        { u: 0.5, len: 0.15 * s, w: 0.034 * s },
      ], 9, 0.5, 0.6, { curl: 0.6 });
      const rays: Ray[] = [];
      for (let i = 0; i < 5; i++) rays.push({ o: [j.ankle[0] + (i - 2) * 0.03 * s * sx, 0.045 * s, j.ankle[2] + 0.17 * s], dir: [0, 1, 0.25] });
      for (const sp of spotsOf(base, rays)) coat.lock(`toe_${n}`, `foot_${n}`, sp, { dir: vnorm([0, -0.3, 1]), len: 0.11 * s, w: 0.026 * s, curl: 0.5, jit: 0.25 });
    }
    if (opts.club !== false) addClub(ctx, rng);
  };
}
