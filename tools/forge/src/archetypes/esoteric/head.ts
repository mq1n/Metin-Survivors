// Monk / zealot / priest heads for the humanoid `hooks.head`: a human skull with a stronger brow shelf, deep-set eyes, optional hollow
// cheeks (gaunt), a choice of mouths (set / snarl / scream) and a jawline that can be tuned from stern to starved. Numbers are in
// head units (a human head is ~0.235 tall) scaled by k = bodyScale * headScale; +Z forward, +X = left, origin = skull centre.
import { type Vec3, qaxis } from '../../core/math.ts';
import { Ellipsoid, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';
import { el, rc } from '../orc/kit.ts';

export interface MonkHeadOpts {
  /** brow ridge heaviness (1 = stern human, 1.5 = beetling) */
  brow?: number;
  /** jaw strength / width */
  jaw?: number;
  /** cheekbone prominence */
  cheeks?: number;
  /** 0..1 hollow cheeks, sunken temples and eye sockets */
  gaunt?: number;
  /** nose size */
  nose?: number;
  /** mouth: set = closed grim line, snarl = lip drawn back over clenched teeth, scream = wide open */
  mouth?: 'set' | 'snarl' | 'scream';
  /** eyeball size multiplier */
  eyes?: number;
  /** outer-corner lift of the eyes (rad): + = fierce upward slant */
  slant?: number;
  /** ear size (1 = human) */
  ears?: number;
  /** glowing eyes (tag 'glow' on the eyeballs) */
  glow?: boolean;
  /** chin beard goatee length (0 = none) */
  goatee?: number;
  /** overall face scale */
  scale?: number;
}

const D = (o: MonkHeadOpts): Required<MonkHeadOpts> => ({
  brow: 1, jaw: 1, cheeks: 1, gaunt: 0, nose: 1, mouth: 'set', eyes: 1, slant: 0.2, ears: 1, glow: false, goatee: 0, scale: 1, ...o,
});

export function monkHead(opts: MonkHeadOpts = {}): (ctx: Ctx) => void {
  const o = D(opts);
  return (ctx) => {
    const a = ctx.a;
    const k = a.s * a.hs * o.scale;
    const sk = a.skull;
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const T = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'head', ...t] });
    const g = o.gaunt;
    const BOTH = [1, -1] as const;
    const nm = (sx: 1 | -1): string => (sx === 1 ? 'l' : 'r');

    // ---- skull: a long cranium with a faint sagittal crest, face mass below
    ctx.add('cranium', el(H(0, 0.03, -0.014), [0.083 * k, 0.082 * k, 0.1 * k]), 'head', { ...T('skull'), w: 0.03 });
    ctx.add('crest', el(H(0, 0.082, -0.01), [0.026 * k, 0.014 * k, 0.07 * k]), 'head', { ...T('skull'), w: 0.02 });
    ctx.add('face', el(H(0, -0.032, 0.02), [(0.072 - 0.012 * g) * k, 0.08 * k, 0.07 * k]), 'head', { ...T('face'), w: 0.03 });

    // ---- brow shelf: heavy roundcones over deep sockets, joined over the nose root
    const browR = (0.0105 + 0.007 * o.brow) * k;
    for (const sx of BOTH) {
      const n = nm(sx);
      ctx.add(`brow_${n}`, rc(H(sx * 0.008, 0.024, 0.083), H(sx * 0.058, 0.03 + 0.012 * o.slant, 0.064), browR, browR * 0.78), 'head', { tags: ['skin', 'head', 'brow'], w: 0.02 });
      // cheekbone (prominent when gaunt) and cheek mass (shrinks when gaunt)
      ctx.add(`cheekbone_${n}`, el(H(sx * 0.054, -0.014, 0.05), [0.022 * k * o.cheeks, 0.016 * k, 0.02 * k], qaxis([0, 1, 0], sx * 0.5)), 'head', { ...T('cheek'), w: 0.02 });
      ctx.add(`cheek_${n}`, el(H(sx * 0.044, -0.04, 0.046), [0.024 * k * (1 - 0.35 * g), 0.026 * k * (1 - 0.3 * g), 0.024 * k], qaxis([0, 1, 0], sx * 0.4)), 'head', { ...T('cheek'), w: 0.026 });
      // hollow temple / cheek under the bone
      if (g > 0.05) ctx.cut(`hollow_${n}`, el(H(sx * 0.07, -0.036, 0.036), [0.015 * k * g, 0.026 * k, 0.022 * k]), 'head', { tags: ['skin', 'head', 'hollow'], w: 0.02 });
    }
    ctx.add('glabella', el(H(0, 0.026, 0.088), [0.02 * k, 0.012 * k * o.brow, 0.012 * k]), 'head', { tags: ['skin', 'head', 'brow'], w: 0.015 });

    // ---- nose: strong bridge, hooked tip
    const nr = (0.008 + 0.0028 * o.nose) * k;
    ctx.add('nose_bridge', rc(H(0, 0.012, 0.086), H(0, -0.026, 0.103), nr * 0.85, nr * 1.15), 'head', { ...T('nose'), w: 0.014 });
    ctx.add('nose_tip', new Sphere(H(0, -0.033, 0.106), nr * 1.2), 'head', { tags: ['skin', 'head', 'nose', 'nosetip'], w: 0.012 });
    for (const sx of BOTH) ctx.add(`nose_ala_${nm(sx)}`, new Sphere(H(sx * 0.0145, -0.031, 0.096), nr * 0.88), 'head', { tags: ['skin', 'head', 'nose'], w: 0.012 });

    // ---- mouth
    const m = o.mouth;
    const lipUp = m === 'snarl' ? 0.0042 : 0.0058;
    ctx.add('lip_up', el(H(0, -0.05, 0.0885), [0.024 * k, lipUp * k, 0.0095 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.011 });
    ctx.add('lip_dn', el(H(0, -0.0625 - (m === 'scream' ? 0.014 : 0), 0.086 - (m === 'scream' ? 0.006 : 0)), [0.021 * k, 0.0066 * k, 0.0095 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.011 });
    if (m === 'scream') {
      ctx.cut('mouth', el(H(0, -0.0585, 0.084), [0.026 * k, 0.0125 * k, 0.018 * k]), 'head', { tags: ['skin', 'head', 'lipline', 'mouthin'], w: 0.004 });
      // upper / lower teeth bars inside the opening
      ctx.late('teeth_up', el(H(0, -0.0505, 0.0845), [0.019 * k, 0.0035 * k, 0.006 * k]), 'head', { tags: ['tooth'], w: 0.002 });
      ctx.late('teeth_dn', el(H(0, -0.0665, 0.0825), [0.017 * k, 0.003 * k, 0.005 * k]), 'head', { tags: ['tooth'], w: 0.002 });
    } else if (m === 'snarl') {
      ctx.cut('mouth', el(H(0, -0.0555, 0.0865), [0.026 * k, 0.0045 * k, 0.014 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.003 });
      ctx.late('teeth_up', el(H(0, -0.0535, 0.0875), [0.02 * k, 0.0026 * k, 0.005 * k]), 'head', { tags: ['tooth'], w: 0.002 });
    } else {
      ctx.cut('mouth', el(H(0, -0.0565, 0.0865), [0.026 * k, 0.0028 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.003 });
    }

    // ---- jaw: angular, with a strong chin; the scream drops the jaw
    const drop = m === 'scream' ? 0.022 : 0;
    const jawR = (0.019 + 0.008 * o.jaw - 0.004 * g) * k;
    const chin: Vec3 = H(0, -0.096 - drop, 0.05 + 0.008 * o.jaw - (m === 'scream' ? 0.01 : 0));
    for (const sx of BOTH) ctx.add(`jaw_${nm(sx)}`, rc(H(sx * (0.06 - 0.004 * g), -0.04, -0.02), chin, jawR, jawR * 0.76), 'head', { ...T('jaw'), w: 0.022 });
    ctx.add('chin', el(chin, [(0.02 + 0.007 * o.jaw - 0.004 * g) * k, 0.017 * k, 0.019 * k]), 'head', { ...T('chin'), w: 0.018 });
    ctx.add('jawfill', el(H(0, -0.064 - drop * 0.4, 0.01), [0.056 * k, 0.042 * k, 0.064 * k], undefined), 'head', { ...T('jaw'), w: 0.03 });
    if (o.goatee > 0) {
      const gl = o.goatee;
      ctx.late('goatee', rc(H(0, -0.1 - drop, 0.058), H(0, -0.1 - 0.05 * gl - drop, 0.05), 0.014 * k, 0.005 * k), 'head', { tags: ['beard'], w: 0.008 });
    }

    // ---- eyes: carved deep sockets, recessed eyeballs, iris / pupil marks
    const es = o.eyes;
    for (const sx of BOTH) {
      const n = nm(sx);
      const rot = qaxis([0, 0, 1], sx * o.slant);
      ctx.cut(`socket_${n}`, el(H(sx * 0.033, -0.003, 0.088), [(0.017 + 0.003 * g) * k * es, (0.0105 + 0.002 * g) * k * es, 0.016 * k], rot), 'head', { tags: ['skin', 'head', 'lid'], w: 0.005 });
      ctx.late(`eye_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0655 - 0.002 * g), 0.0098 * k * es), 'head', { tags: o.glow ? ['eye', 'glow'] : ['eye'], w: 0.002 });
      ctx.mark(`iris_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0765 - 0.002 * g), 0.0064 * k * es), ['iris']);
      ctx.mark(`pupil_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0775 - 0.002 * g), 0.0032 * k * es), ['pupil']);
      ctx.mark(`lid_${n}`, el(H(sx * 0.033, 0.004, 0.082), [0.019 * k * es, 0.0075 * k * es, 0.011 * k], rot), ['lidline']);
    }

    // ---- ears: large, slightly swept back (monk's long lobes)
    for (const sx of BOTH) {
      const n = nm(sx);
      const base = H(sx * 0.082, -0.004, -0.008);
      const tip = H(sx * (0.094 + 0.014 * o.ears), -0.004 - 0.008 * o.ears, -0.026);
      ctx.add(`ear_${n}`, flatCone(base, tip, 0.024 * k * o.ears, 0.01 * k * o.ears, 0.3, [sx, 0.1, 0.2]), 'head', { tags: ['skin', 'head', 'ear'], w: 0.012 });
      ctx.add(`earlobe_${n}`, new Sphere(H(sx * 0.088, -0.036 * o.ears, -0.01), 0.0085 * k * o.ears), 'head', { tags: ['skin', 'head', 'ear'], w: 0.01 });
    }
    void Ellipsoid;
  };
}
