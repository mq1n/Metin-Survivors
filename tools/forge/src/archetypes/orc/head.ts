// Orc / goblin heads for the humanoid `hooks.head`: sloped skull, shelf-like brow over deep-set eyes, flat wide nose with
// flared nostrils, heavy underbite jaw with upturned lower tusks, pointed swept ears. All numbers in head units (a human head is
// ~0.235 tall) scaled by k = bodyScale * headScale; +Z forward, +X = left, origin = skull centre (`a.skull`).
import { type Vec3, qaxis } from '../../core/math.ts';
import { Ellipsoid, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';
import { el, horn, rc } from './kit.ts';

export interface OrcHeadOpts {
  /** brow ridge heaviness (1 = orc, 0.6 = lean goblin) */
  brow?: number;
  /** lower-jaw size and forward thrust (underbite) */
  jaw?: number;
  /** muzzle width / flatness of the nose */
  snout?: number;
  /** lower tusk size (0 = none) */
  tusk?: number;
  /** tusk curl: how far the tips bend outward and back */
  curl?: number;
  /** small upper fangs */
  fangs?: boolean;
  /** ear length multiplier (1 = orc, 1.9 = goblin) */
  ears?: number;
  /** ear droop (0 = swept up, 1 = hanging) */
  droop?: number;
  /** cheek / jowl mass */
  cheeks?: number;
  /** cranium size: smaller = brutish sloped skull */
  cranium?: number;
  /** extra overall face scale */
  scale?: number;
  /** glowing eyes (tag 'glow' on the eyeballs; the paint stage turns it into emissive) */
  glow?: boolean;
  /** scar across the left eye */
  scar?: boolean;
}

const D = (o: OrcHeadOpts): Required<OrcHeadOpts> => ({
  brow: 1, jaw: 1, snout: 1, tusk: 1, curl: 1, fangs: true, ears: 1, droop: 0.2, cheeks: 1, cranium: 1, scale: 1, glow: false, scar: false, ...o,
});

export function orcHead(opts: OrcHeadOpts = {}): (ctx: Ctx) => void {
  const o = D(opts);
  return (ctx) => {
    const a = ctx.a;
    const k = a.s * a.hs * o.scale;
    const sk = a.skull;
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const T = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'head', ...t] });
    const sn = o.snout;
    const jw = o.jaw;

    // ---- cranium: smaller, set back, sloped; the face mass carries the weight
    ctx.add('cranium', el(H(0, 0.026, -0.03), [0.086 * k * o.cranium, 0.088 * k * o.cranium, 0.098 * k * o.cranium]), 'head', { ...T('skull'), w: 0.03 });
    ctx.add('forehead', el(H(0, 0.03, 0.03), [0.07 * k, 0.06 * k, 0.06 * k]), 'head', { ...T('skull'), w: 0.03 });
    ctx.add('face', el(H(0, -0.03, 0.03), [0.084 * k, 0.08 * k, 0.08 * k]), 'head', { ...T('face'), w: 0.03 });

    // ---- brow shelf: heavy roundcones over deep sockets, joined over the nose root
    const browR = 0.0165 * k * o.brow;
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      ctx.add(`brow_${n}`, rc(H(sx * 0.006, 0.03, 0.088), H(sx * 0.07, 0.04, 0.062), browR, browR * 0.82), 'head', { tags: ['skin', 'head', 'brow'], w: 0.02 });
      // heavy cheekbones
      ctx.add(`cheek_${n}`, el(H(sx * 0.064, -0.026, 0.06), [0.034 * k * o.cheeks, 0.028 * k, 0.034 * k]), 'head', { ...T('cheek'), w: 0.03 });
      // jowl pad over the corner of the mouth
      ctx.add(`jowl_${n}`, el(H(sx * 0.052, -0.062, 0.068), [0.026 * k * o.cheeks, 0.022 * k, 0.03 * k]), 'head', { ...T('jowl'), w: 0.02 });
    }
    ctx.add('glabella', el(H(0, 0.028, 0.092), [0.02 * k, 0.012 * k * o.brow, 0.014 * k]), 'head', { tags: ['skin', 'head', 'brow'], w: 0.015 });

    // ---- nose: broad, short, upturned, with flared alae
    ctx.add('nose_bridge', rc(H(0, 0.012, 0.09), H(0, -0.03, 0.106), 0.012 * k, 0.017 * k * sn), 'head', { ...T('nose'), w: 0.018 });
    ctx.add('nose_tip', el(H(0, -0.037, 0.11), [0.021 * k * sn, 0.015 * k, 0.016 * k]), 'head', { tags: ['skin', 'head', 'nose', 'nosetip'], w: 0.012 });
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      ctx.add(`nose_ala_${n}`, el(H(sx * 0.02 * sn, -0.035, 0.1), [0.013 * k, 0.012 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'nose'], w: 0.012 });
      ctx.cut(`nostril_${n}`, el(H(sx * 0.0125 * sn, -0.043, 0.117), [0.0058 * k, 0.0042 * k, 0.0075 * k]), 'head', { tags: ['skin', 'head', 'nostril'], w: 0.004 });
    }

    // ---- upper lip / maxilla (short), mouth slit
    ctx.add('maxilla', el(H(0, -0.058, 0.082), [0.054 * k * sn, 0.022 * k, 0.034 * k]), 'head', { ...T('lip'), w: 0.02 });
    ctx.add('lip_up', el(H(0, -0.062, 0.1), [0.036 * k * sn, 0.0085 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.012 });

    // ---- heavy underbite jaw: wide ramus, big chin block jutting past the upper lip
    const jawR = 0.03 * k * jw;
    const chin: Vec3 = H(0, -0.104, 0.082 + 0.018 * jw);
    for (const sx of [1, -1] as (1 | -1)[]) {
      ctx.add(`jaw_${sx === 1 ? 'l' : 'r'}`, rc(H(sx * 0.068, -0.036, -0.026), chin, jawR, jawR * 0.84), 'head', { ...T('jaw'), w: 0.025 });
    }
    ctx.add('chin', el(H(0, -0.1, 0.08 + 0.02 * jw), [0.044 * k * jw, 0.03 * k * jw, 0.032 * k * jw]), 'head', { ...T('chin'), w: 0.02 });
    ctx.add('jawfill', el(H(0, -0.066, 0.016), [0.066 * k, 0.05 * k, 0.07 * k]), 'head', { ...T('jaw'), w: 0.03 });
    ctx.add('lip_dn', el(H(0, -0.078, 0.096 + 0.012 * jw), [0.032 * k * sn, 0.0095 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.012 });
    ctx.cut('mouth', el(H(0, -0.0705, 0.098 + 0.004 * jw), [0.044 * k * sn, 0.0036 * k, 0.016 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.004 });

    // ---- tusks: lower tusks rise from the jaw past the upper lip, curling out; optional small upper fangs
    if (o.tusk > 0) {
      const t = o.tusk, cu = o.curl;
      for (const sx of [1, -1] as (1 | -1)[]) {
        const n = sx === 1 ? 'l' : 'r';
        const b0 = H(sx * 0.03, -0.083, 0.1 + 0.014 * jw);
        const m0 = H(sx * (0.037 + 0.006 * cu), -0.05 + 0.002 * t, 0.116 + 0.012 * jw + 0.006 * cu);
        const t0 = H(sx * (0.039 + 0.01 * cu), -0.006 + 0.032 * t, 0.112 + 0.014 * jw + 0.016 * cu);
        ctx.late(`tusk_${n}`, horn(b0, m0, t0, 0.0105 * k * (0.7 + 0.5 * t), 0.0016 * k), 'head', { tags: ['tusk'], w: 0.002 });
        if (o.fangs) {
          ctx.late(`fang_${n}`, rc(H(sx * 0.02, -0.066, 0.104), H(sx * 0.021, -0.088, 0.106), 0.0045 * k, 0.0011 * k), 'head', { tags: ['tusk'], w: 0.002 });
        }
      }
    }

    // ---- eyes: deep sockets under the brow, small beady eyeballs (marks add iris / pupil / glow)
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      const rot = qaxis([0, 0, 1], sx * 0.28);
      ctx.cut(`socket_${n}`, el(H(sx * 0.036, 0.0, 0.088), [0.0185 * k, 0.0115 * k, 0.017 * k], rot), 'head', { tags: ['skin', 'head', 'lid'], w: 0.006 });
      ctx.late(`eye_${n}`, new Sphere(H(sx * 0.036, -0.001, 0.0745), 0.0102 * k), 'head', { tags: o.glow ? ['eye', 'glow'] : ['eye'], w: 0.002 });
      ctx.mark(`iris_${n}`, new Sphere(H(sx * 0.036, -0.001, 0.0845), 0.0072 * k), ['iris']);
      ctx.mark(`pupil_${n}`, new Sphere(H(sx * 0.036, -0.001, 0.0855), 0.0034 * k), ['pupil']);
      ctx.mark(`lid_${n}`, el(H(sx * 0.036, 0.007, 0.087), [0.02 * k, 0.009 * k, 0.012 * k], rot), ['lidline']);
    }

    // ---- ears: long, pointed, swept back and up (or drooping)
    const eL = o.ears;
    const rise = (1 - o.droop) * 0.07 - o.droop * 0.03;
    for (const sx of [1, -1] as (1 | -1)[]) {
      const n = sx === 1 ? 'l' : 'r';
      const bone = a.layout.ears ? `ear_${n}` : 'head';
      const base = H(sx * 0.086, -0.012, -0.012);
      const tip = H(sx * (0.086 + 0.075 * eL), -0.012 + rise * eL + 0.012, -0.05 - 0.016 * eL);
      ctx.add(`ear_${n}`, flatCone(base, tip, 0.026 * k, 0.0045 * k, 0.28, [sx, 0.1, 0.15]), bone, { tags: ['skin', 'head', 'ear'], w: 0.015 });
      ctx.add(`ear_in_${n}`, flatCone(H(sx * 0.09, -0.01, -0.006), H(sx * (0.09 + 0.062 * eL), -0.008 + rise * 0.85 * eL + 0.01, -0.044 - 0.012 * eL), 0.015 * k, 0.003 * k, 0.2, [sx, 0.1, 0.15]), bone, { tags: ['skin', 'head', 'ear_inner'], w: 0.004 });
    }

    // ---- scar (paint) over the left eye
    if (o.scar) {
      ctx.mark('scar', rc(H(0.05, 0.06, 0.07), H(0.026, -0.036, 0.1), 0.0022 * k, 0.0022 * k), ['ink']);
    }
    void Ellipsoid;
  };
}
