// Heads: stylised heroic human face (skull, jaw, brow, nose, lips, eye sockets + eyeballs, ears) and a lupine head for the wolfman.
import { type Vec3, qaxis, vadd, vnorm, vscale } from '../../core/math.ts';
import { Ellipsoid, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import type { Ctx } from './kit/ctx.ts';
import type { Side } from './params.ts';

const rc = (a: Vec3, b: Vec3, ra: number, rb: number): Sdf => new RoundCone(a, b, ra, rb);
const el = (c: Vec3, r: Vec3, rot?: [number, number, number, number]): Sdf => new Ellipsoid(c, r, rot);

export function buildHead(ctx: Ctx): void {
  if (ctx.a.p.head === 'wolf') buildWolfHead(ctx);
  else buildHumanHead(ctx);
}

export function buildHumanHead(ctx: Ctx): void {
  const a = ctx.a;
  const f = a.face;
  const k = a.s * a.hs;
  const sk = a.skull;
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  const fem = a.fem;
  const T = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'head', ...t] });

  // cranium + face mass + jaw
  ctx.add('cranium', el(H(0, 0.03, -0.012), [0.085 * k, 0.082 * k, 0.098 * k]), 'head', { ...T('skull'), w: 0.03 });
  ctx.add('face', el(H(0, -0.032, 0.018), [(0.074 - 0.004 * fem) * k, 0.08 * k, 0.07 * k]), 'head', { ...T('face'), w: 0.03 });
  const jawR = (0.021 + 0.007 * f.jaw - 0.003 * fem) * k;
  const chin: Vec3 = H(0, -0.094 + 0.004 * fem, 0.05 + 0.006 * f.jaw);
  for (const sx of [1, -1] as Side[]) {
    ctx.add(`jaw_${sx === 1 ? 'l' : 'r'}`, rc(H(sx * (0.06 - 0.004 * fem), -0.04, -0.022), chin, jawR, jawR * 0.78), 'head', { ...T('jaw'), w: 0.022 });
  }
  ctx.add('chin', el(chin, [(0.018 + 0.008 * f.jaw - 0.004 * fem) * k, 0.016 * k, 0.017 * k]), 'head', { ...T('chin'), w: 0.018 });
  ctx.add('jawfill', el(H(0, -0.064, 0.008), [0.058 * k, 0.042 * k, 0.064 * k]), 'head', { ...T('jaw'), w: 0.03 });
  // cheekbones
  for (const sx of [1, -1] as Side[]) {
    ctx.add(`cheek_${sx === 1 ? 'l' : 'r'}`, el(H(sx * 0.047, -0.02, 0.05), [0.024 * k * (0.8 + 0.4 * f.cheeks), 0.02 * k, 0.022 * k]), 'head', { ...T('cheek'), w: 0.03 });
  }
  // brow ridge: short arched roundcones, inner end low and close to the nose, outer end up and back
  const browR = (0.0085 + 0.006 * f.brow - 0.002 * fem) * k;
  for (const sx of [1, -1] as Side[]) {
    ctx.add(`brow_${sx === 1 ? 'l' : 'r'}`, rc(H(sx * 0.013, 0.022, 0.082), H(sx * 0.054, 0.027 + 0.008 * f.slant, 0.066), browR, browR * 0.75), 'head', { tags: ['skin', 'head', 'brow'], w: 0.016 });
  }
  // nose
  const nr = (0.0078 + 0.0028 * f.nose) * k;
  ctx.add('nose_bridge', rc(H(0, 0.008, 0.083), H(0, -0.026, 0.099), nr * 0.8, nr * 1.1), 'head', { ...T('nose'), w: 0.014 });
  ctx.add('nose_tip', new Sphere(H(0, -0.033, 0.103), nr * 1.15), 'head', { tags: ['skin', 'head', 'nose', 'nosetip'], w: 0.012 });
  for (const sx of [1, -1] as Side[]) {
    ctx.add(`nose_ala_${sx === 1 ? 'l' : 'r'}`, new Sphere(H(sx * 0.0135, -0.03, 0.093), nr * 0.85), 'head', { tags: ['skin', 'head', 'nose'], w: 0.012 });
  }
  // mouth: lips (ridges) around a carved slit
  const lp = 0.75 + 0.5 * f.lips + 0.2 * fem;
  ctx.add('lip_up', el(H(0, -0.051, 0.0885), [0.022 * k, 0.0058 * k * lp, 0.009 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.011 });
  ctx.add('lip_dn', el(H(0, -0.0625, 0.0865), [0.02 * k, 0.0066 * k * lp, 0.009 * k]), 'head', { tags: ['skin', 'head', 'lip'], w: 0.011 });
  ctx.cut('mouth', el(H(0, -0.0565, 0.0865), [0.025 * k, 0.0028 * k, 0.012 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.003 });
  // eyes: carved sockets, recessed eyeballs, iris / pupil marks
  const es = f.eyes * (1 + 0.1 * fem);
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const rot = qaxis([0, 0, 1], sx * f.slant * 0.5);
    ctx.cut(`socket_${n}`, el(H(sx * 0.033, -0.003, 0.088), [0.0165 * k * es, 0.0105 * k * es, 0.014 * k], rot), 'head', { tags: ['skin', 'head', 'lid'], w: 0.005 });
    ctx.late(`eye_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0665), 0.0098 * k * es), 'head', { tags: ['eye'], w: 0.002 });
    ctx.mark(`iris_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0775), 0.0062 * k * es), ['iris']);
    ctx.mark(`pupil_${n}`, new Sphere(H(sx * 0.033, -0.004, 0.0785), 0.0031 * k * es), ['pupil']);
    ctx.mark(`lid_${n}`, el(H(sx * 0.033, 0.003, 0.082), [0.018 * k * es, 0.007 * k * es, 0.011 * k], rot), ['lidline']);
  }
  // ears: flattened shell with a small lobe, set back from the cheek
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    ctx.add(`ear_${n}`, el(H(sx * 0.082, -0.012, -0.008), [0.0085 * k * f.ears, 0.027 * k * f.ears, 0.018 * k * f.ears], qaxis([0, 1, 0], sx * 0.35)), 'head', { tags: ['skin', 'head', 'ear'], w: 0.012 });
    ctx.add(`earlobe_${n}`, new Sphere(H(sx * 0.084, -0.034 * f.ears, -0.004), 0.0075 * k * f.ears), 'head', { tags: ['skin', 'head', 'ear'], w: 0.01 });
  }
  void tube; void vadd; void vnorm; void vscale;
}

export function buildWolfHead(ctx: Ctx): void {
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  const T = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'fur', 'head', ...t] });
  // skull + brow
  ctx.add('cranium', el(H(0, 0.02, -0.01), [0.09 * k, 0.092 * k, 0.098 * k]), 'head', { ...T('skull'), w: 0.03 });
  ctx.add('face', el(H(0, -0.02, 0.04), [0.074 * k, 0.07 * k, 0.085 * k]), 'head', { ...T('face'), w: 0.03 });
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    ctx.add(`brow_${n}`, rc(H(sx * 0.012, 0.03, 0.088), H(sx * 0.06, 0.04, 0.062), 0.018 * k, 0.015 * k), 'head', { tags: ['skin', 'fur', 'head', 'brow'], w: 0.02 });
    ctx.add(`cheek_${n}`, el(H(sx * 0.052, -0.03, 0.06), [0.032 * k, 0.034 * k, 0.04 * k]), 'head', { ...T('cheek'), w: 0.03 });
  }
  // muzzle: tapering snout with a nose pad, mouth line and bared fangs
  ctx.add('snout_bridge', rc(H(0, 0.0, 0.07), H(0, -0.03, 0.19), 0.04 * k, 0.026 * k), 'head', { ...T('muzzle'), w: 0.025 });
  ctx.add('snout_top', el(H(0, -0.005, 0.15), [0.03 * k, 0.026 * k, 0.065 * k]), 'head', { ...T('muzzle'), w: 0.02 });
  ctx.add('nose_pad', new Ellipsoid(H(0, -0.024, 0.205), [0.021 * k, 0.017 * k, 0.014 * k]), 'head', { tags: ['skin', 'head', 'nose', 'nosetip'], w: 0.012 });
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    ctx.add(`lip_up_${n}`, rc(H(sx * 0.006, -0.046, 0.19), H(sx * 0.034, -0.048, 0.1), 0.012 * k, 0.011 * k), 'head', { tags: ['skin', 'fur', 'head', 'muzzle', 'lip'], w: 0.012 });
  }
  ctx.add('jaw_low', rc(H(0, -0.078, 0.09), H(0, -0.072, 0.175), 0.03 * k, 0.017 * k), 'head', { ...T('jaw'), w: 0.02 });
  ctx.add('jaw_back', el(H(0, -0.07, 0.02), [0.06 * k, 0.04 * k, 0.06 * k]), 'head', { ...T('jaw'), w: 0.03 });
  ctx.cut('mouth', el(H(0, -0.058, 0.138), [0.034 * k, 0.0042 * k, 0.05 * k]), 'head', { tags: ['skin', 'head', 'lipline'], w: 0.004 });
  // fangs (upper and lower)
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    ctx.late(`fang_up_${n}`, rc(H(sx * 0.024, -0.052, 0.168), H(sx * 0.026, -0.082, 0.17), 0.0052 * k, 0.0012 * k), 'head', { tags: ['fang'], w: 0.002 });
    ctx.late(`fang_dn_${n}`, rc(H(sx * 0.017, -0.066, 0.18), H(sx * 0.018, -0.04, 0.183), 0.0045 * k, 0.001 * k), 'head', { tags: ['fang'], w: 0.002 });
  }
  // eyes: slanted, set into the brow
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const rot = qaxis([0, 0, 1], sx * 0.45);
    ctx.cut(`socket_${n}`, el(H(sx * 0.036, 0.008, 0.083), [0.021 * k, 0.012 * k, 0.017 * k], rot), 'head', { tags: ['skin', 'head', 'lid'], w: 0.006 });
    ctx.late(`eye_${n}`, new Sphere(H(sx * 0.036, 0.007, 0.073), 0.0105 * k), 'head', { tags: ['eye'], w: 0.002 });
    ctx.mark(`iris_${n}`, new Sphere(H(sx * 0.036, 0.007, 0.083), 0.0075 * k), ['iris']);
    ctx.mark(`pupil_${n}`, new Sphere(H(sx * 0.036, 0.007, 0.0845), 0.0034 * k), ['pupil']);
  }
  // ears: tall, pointed, set high
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    ctx.add(`ear_${n}`, flatCone(H(sx * 0.052, 0.07, -0.028), H(sx * 0.07, 0.19, -0.06), 0.036 * k, 0.007 * k, 0.3, [sx, 0, 0.12]), a.layout.ears ? `ear_${n}` : 'head', { tags: ['skin', 'fur', 'head', 'ear'], w: 0.015 });
    ctx.add(`ear_in_${n}`, flatCone(H(sx * 0.054, 0.08, -0.02), H(sx * 0.068, 0.17, -0.052), 0.022 * k, 0.005 * k, 0.2, [sx, 0, 0.12]), a.layout.ears ? `ear_${n}` : 'head', { tags: ['skin', 'head', 'ear_inner'], w: 0.005 });
  }
  void vadd; void vnorm; void vscale; void tube;
}
