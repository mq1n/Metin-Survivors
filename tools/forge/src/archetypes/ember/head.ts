// Ember demon head for the humanoid `hooks.head`: sloped skull, thick brow bar over deep glowing eye slits, flat skull-like nose,
// wide snarling mouth (cut tagged 'lipline' so the paint stage lights it), upper fangs, lower tusks, angular swept ear fins.
// All numbers in head units (a human head is ~0.235 tall) scaled by k = bodyScale * headScale; +Z forward, +X = left, origin = skull centre.
import { type Quat, type Vec3, qaxis } from '../../core/math.ts';
import { Ellipsoid, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';
import { Shard } from './shard.ts';

export interface DemonHeadOpts {
  /** brow bar heaviness (1 = brute) */
  brow?: number;
  /** jaw size / forward thrust */
  jaw?: number;
  /** lower tusk length multiplier (0 = none) */
  tusk?: number;
  /** upper fang row */
  fangs?: boolean;
  /** cheekbone mass */
  cheeks?: number;
  /** mouth gape (cut height multiplier; 1 = snarl, 2 = roar) */
  gape?: number;
  /** extra face scale */
  scale?: number;
  /** ear fin length (0 = none) */
  ears?: number;
  /** the marker tag of the reserved piece used for ears (obsidian shards) */
  earTag?: string;
}

export function demonHead(opts: DemonHeadOpts = {}): (ctx: Ctx) => void {
  const o = { brow: 1, jaw: 1, tusk: 1, fangs: true, cheeks: 1, gape: 1, scale: 1, ears: 1, earTag: '', ...opts };
  return (ctx) => {
    const a = ctx.a;
    const k = a.s * a.hs * o.scale;
    const sk = a.skull;
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const T = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'head', ...t] });
    const el = (c: Vec3, r: Vec3, rot?: Quat): Ellipsoid => new Ellipsoid(c, r, rot);
    const rc = (p: Vec3, q: Vec3, r0: number, r1: number): RoundCone => new RoundCone(p, q, r0, r1);
    const jw = o.jaw;

    // cranium: sloped, set back; forehead block leans over the face
    ctx.add('cranium', el(H(0, 0.02, -0.032), [0.092 * k, 0.09 * k, 0.102 * k]), 'head', { ...T('skull'), w: 0.03 });
    ctx.add('forehead', el(H(0, 0.03, 0.034), [0.074 * k, 0.056 * k, 0.062 * k]), 'head', { ...T('skull'), w: 0.03 });
    ctx.add('face', el(H(0, -0.03, 0.036), [0.086 * k, 0.082 * k, 0.082 * k]), 'head', { ...T('face'), w: 0.03 });

    // brow bar: a thick shelf over the eyes, joined over the nose root; drops at the outer corners
    const br = 0.02 * k * o.brow;
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      ctx.add(`brow_${n}`, rc(H(sx * 0.004, 0.034, 0.094), H(sx * 0.076, 0.03, 0.058), br, br * 0.78), 'head', { tags: ['skin', 'head', 'brow'], w: 0.018 });
      ctx.add(`cheek_${n}`, el(H(sx * 0.066, -0.03, 0.062), [0.036 * k * o.cheeks, 0.03 * k, 0.036 * k]), 'head', { ...T('cheek'), w: 0.03 });
      ctx.add(`jowl_${n}`, el(H(sx * 0.056, -0.066, 0.07), [0.026 * k, 0.022 * k, 0.03 * k]), 'head', { ...T('jowl'), w: 0.02 });
    }
    ctx.add('glabella', el(H(0, 0.03, 0.098), [0.024 * k, 0.014 * k * o.brow, 0.014 * k]), 'head', { tags: ['skin', 'head', 'brow'], w: 0.014 });

    // nose: flat, broad, skull-like slit nostrils
    ctx.add('nose_bridge', rc(H(0, 0.01, 0.092), H(0, -0.034, 0.104), 0.012 * k, 0.016 * k), 'head', { ...T('nose'), w: 0.018 });
    ctx.add('nose_tip', el(H(0, -0.04, 0.108), [0.02 * k, 0.014 * k, 0.014 * k]), 'head', { tags: ['skin', 'head', 'nose'], w: 0.012 });
    for (const sx of [1, -1] as (1 | -1)[]) {
      ctx.cut(`nostril_${sx === 1 ? 'l' : 'r'}`, el(H(sx * 0.011, -0.045, 0.116), [0.0045 * k, 0.0065 * k, 0.007 * k]), 'head', { tags: ['skin', 'head', 'nostril'], w: 0.004 });
    }

    // upper lip / maxilla and heavy underbite jaw
    ctx.add('maxilla', el(H(0, -0.062, 0.084), [0.058 * k, 0.024 * k, 0.036 * k]), 'head', { ...T('lip'), w: 0.02 });
    ctx.add('lip_up', el(H(0, -0.066, 0.104), [0.04 * k, 0.009 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.012 });
    const jawR = 0.032 * k * jw;
    const chin: Vec3 = H(0, -0.108, 0.088 + 0.016 * jw);
    for (const sx of [1, -1] as (1 | -1)[]) {
      ctx.add(`jaw_${sx === 1 ? 'l' : 'r'}`, rc(H(sx * 0.072, -0.034, -0.024), chin, jawR, jawR * 0.82), 'head', { ...T('jaw'), w: 0.025 });
    }
    ctx.add('chin', el(H(0, -0.104, 0.088 + 0.018 * jw), [0.048 * k * jw, 0.032 * k * jw, 0.034 * k * jw]), 'head', { ...T('chin'), w: 0.02 });
    ctx.add('jawfill', el(H(0, -0.068, 0.016), [0.07 * k, 0.052 * k, 0.07 * k]), 'head', { ...T('jaw'), w: 0.03 });
    ctx.add('lip_dn', el(H(0, -0.083, 0.098 + 0.012 * jw), [0.036 * k, 0.01 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.012 });
    // snarling mouth: a wide dark slit (tagged lipline -> glows from inside)
    ctx.cut('mouth', el(H(0, -0.0745, 0.1 + 0.004 * jw), [0.05 * k, 0.0062 * k * o.gape, 0.02 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.004 });

    // fangs: a row of small upper teeth + big lower tusks curling up past the lip
    if (o.fangs) {
      for (const x of [-0.034, -0.018, 0.018, 0.034]) {
        const big = Math.abs(x) > 0.03;
        ctx.late(`fang_${x}`, rc(H(x, -0.07, 0.106), H(x * 1.04, -0.07 - (big ? 0.026 : 0.018), 0.108), 0.0044 * k, 0.0011 * k), 'head', { tags: ['tusk'], w: 0.002 });
      }
    }
    if (o.tusk > 0) {
      for (const sx of [1, -1] as (1 | -1)[]) {
        const b0 = H(sx * 0.034, -0.086, 0.102 + 0.012 * jw);
        const m0 = H(sx * 0.046, -0.05, 0.12 + 0.01 * jw);
        const t0 = H(sx * 0.05, -0.0 + 0.034 * o.tusk - 0.02, 0.116 + 0.016 * jw);
        ctx.late(`tusk_${sx === 1 ? 'l' : 'r'}`, tube([b0, m0, t0], [[0, 0.0125 * k], [0.55, 0.0085 * k], [1, 0.0016 * k]], { segments: 4, w: 0.002 }), 'head', { tags: ['tusk'], w: 0.002 });
      }
    }

    // eyes: narrow slits deep under the brow, glowing eyeballs (tag 'eye' -> emissive in the model paint)
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      const rot = qaxis([0, 0, 1], sx * 0.42);
      ctx.cut(`socket_${n}`, el(H(sx * 0.037, 0.0, 0.09), [0.02 * k, 0.0105 * k, 0.018 * k], rot), 'head', { tags: ['skin', 'head', 'lid'], w: 0.005 });
      ctx.late(`eye_${n}`, new Sphere(H(sx * 0.037, -0.001, 0.076), 0.0108 * k), 'head', { tags: ['eye'], w: 0.002 });
      ctx.mark(`lid_${n}`, el(H(sx * 0.037, 0.0075, 0.089), [0.021 * k, 0.0085 * k, 0.012 * k], rot), ['lidline']);
    }

    // ear fins: flat angular shards swept back
    if (o.ears > 0 && o.earTag) {
      for (const sx of [1, -1] as (1 | -1)[]) {
        const base = H(sx * 0.086, -0.01, -0.008);
        const tip = H(sx * (0.086 + 0.07 * o.ears), 0.014, -0.06 * o.ears - 0.01);
        ctx.add(`ear_${sx === 1 ? 'l' : 'r'}`, new Shard(base, tip, 0.026 * k, 0.0105 * k, { side: [0, 1, 0.3], tu: 0.006 * k, tv: 0.004 * k, root: 0.015 * k }), 'head', { tags: [o.earTag], w: 0.01, grip: 1.6 });
      }
    }
  };
}
