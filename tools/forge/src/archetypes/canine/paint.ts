// Canine paint: coat pattern + anatomy accents + hair texture (baked into the albedo texture), with AO/cavity/hemi/rim as
// the per-vertex shade multiplier (COLOR_0).
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, blotches, bones, cavity, custom, fill, furClumps, gradient, grain, hemi, layer, region, rimTint, stripes, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';

export function makePaint(a: Anatomy, textureSize = 1024): PaintSpec {
  const p = a.p;
  const pal = p.palette;
  const s = a.s;
  const belly = 0.36 * s;
  const withers = a.withersY;
  type RV = { region(tag: string, soft?: number): number };
  const torsoMask = (v: RV): number => Math.max(v.region('torso', 0.03), v.region('neck', 0.03), v.region('tail', 0.02), v.region('ruff', 0.02), v.region('mane', 0.02));
  const out: PaintLayer[] = [fill(pal.flank)];

  // ---- vertical coat gradient: light belly -> flank -> dark back
  out.push(
    gradient([0, 1, 0], belly, withers, [
      [0, pal.light],
      [0.2, mixRgb(pal.light, pal.flank, 0.7)],
      [0.48, pal.flank],
      [0.8, mixRgb(pal.flank, pal.back, 0.85)],
      [1, pal.back],
    ], { warp: { freq: 6 / s, amp: 0.1 }, mask: (v) => torsoMask(v) }),
  );

  // ---- coat pattern
  switch (p.pattern) {
    case 'saddle':
      out.push(blotches(pal.back, { freq: 9 / s, threshold: -0.05, softness: 0.2, strength: 0.9, stretch: [0.6, 1.25, 0.32], octaves: 3, seedOffset: p.seed, mask: (v) => smoothstep(0.05, 0.5, v.n[1]) * smoothstep(0.52 * s, 0.7 * s, v.p[1]) * torsoMask(v) }));
      out.push(blotches(adjust(pal.light, 0.05, 0.6), { freq: 30 / s, threshold: 0.32, softness: 0.14, strength: 0.42, stretch: [1.3, 1.5, 0.16], seedOffset: p.seed + 3, mask: (v) => smoothstep(0.0, 0.6, 1 - Math.abs(v.n[1])) * torsoMask(v) }));
      break;
    case 'patch':
      out.push(blotches(pal.back, { freq: 7 / s, threshold: 0.1, softness: 0.1, strength: 0.95, stretch: [0.8, 1, 0.8], octaves: 2, seedOffset: p.seed, mask: torsoMask }));
      out.push(blotches(pal.light, { freq: 9 / s, threshold: 0.3, softness: 0.08, strength: 0.9, octaves: 2, seedOffset: p.seed + 11, mask: (v) => (1 - smoothstep(0.4, 0.7, v.n[1])) * torsoMask(v) }));
      break;
    case 'frost':
      out.push(gradient([0, 0, 1], -0.6 * s, 0.4 * s, [[0, pal.back], [0.35, mixRgb(pal.back, pal.flank, 0.55)], [1, pal.light]], { strength: 0.8, warp: { freq: 6 / s, amp: 0.1 }, mask: torsoMask }));
      out.push(blotches(adjust(pal.light, 0.1, 0.5), { freq: 12 / s, threshold: 0.15, softness: 0.15, strength: 0.7, stretch: [0.9, 1, 0.3], seedOffset: p.seed, mask: (v) => smoothstep(0.1, 0.6, v.n[1]) * torsoMask(v) }));
      break;
    case 'agouti':
      out.push(stripes(pal.dark, { axis: [0, 0, 1], period: 0.1 * s, duty: 0.3, warpAmp: 0.6, warpFreq: 8 / s, softness: 0.25, strength: 0.55, mask: (v) => smoothstep(0.2, 0.7, v.n[1]) * smoothstep(0.55 * s, 0.7 * s, v.p[1]) * torsoMask(v) }));
      out.push(blotches(pal.back, { freq: 8 / s, threshold: 0.0, softness: 0.2, strength: 0.6, stretch: [0.5, 1, 0.3], seedOffset: p.seed, mask: (v) => smoothstep(0.1, 0.5, v.n[1]) * torsoMask(v) }));
      break;
  }

  if ((p.mange ?? 0) > 0) {
    // fur loss: bare grey-pink skin patches + weeping sores
    const mg = p.mange ?? 0;
    out.push(blotches(mixRgb(pal.inner, pal.back, 0.45), { freq: 11 / s, threshold: 0.18 - 0.16 * mg, softness: 0.1, strength: 0.9, stretch: [0.9, 1, 0.9], octaves: 3, seedOffset: p.seed + 21, mask: torsoMask }));
    out.push(blotches(pal.mouth, { freq: 26 / s, threshold: 0.42 - 0.1 * mg, softness: 0.08, strength: 0.7, octaves: 2, seedOffset: p.seed + 33, mask: torsoMask }));
  }
  if ((p.ribs ?? 0) > 0) out.push(region('rib', mixRgb(pal.inner, pal.light, 0.35), 0.75, 0.01));

  // ---- limbs: pale lower legs, dark front "stockings", paws
  out.push(bones(['forearm_l', 'forearm_r', 'hand_l', 'hand_r'], pal.dark, 0.45, [0.3, 0.9]));
  out.push(bones(['shin_l', 'shin_r', 'foot_l', 'foot_r', 'toe_l', 'toe_r'], mixRgb(pal.flank, pal.light, 0.6), 0.5, [0.3, 0.9]));
  out.push(region('paw', mixRgb(pal.dark, pal.flank, 0.45), 0.6, 0.012));
  out.push(region('tuft', pal.light, 0.35, 0.015));
  out.push(region('toe', mixRgb(pal.dark, pal.flank, 0.3), 0.8, 0.004));
  out.push(region('claw', pal.claw, 1, 0.003));

  // ---- tail: dark tip, pale underside
  out.push(region('tail_tip', pal.dark, 0.95, 0.04));
  if (pal.spirit) out.push(region('spirit', pal.spirit, 0.55, 0.05));
  out.push(layer('tailUnder', pal.light, (v) => clamp01(v.region('tail', 0.02)) * smoothstep(0.1, -0.5, v.n[1]) * 0.6));

  // ---- head
  out.push(region('muzzle', pal.muzzle, 0.9, 0.025));
  out.push(region('cheek', mixRgb(pal.muzzle, pal.light, 0.5), 0.55, 0.035));
  out.push(layer('throat', pal.light, (v) => v.region('throat', 0.05) * 0.8));
  out.push(layer('muzzleTop', pal.dark, (v) => v.region('muzzle', 0.03) * smoothstep(0.55, 0.95, v.n[1]) * 0.4 * (1 - v.region('jaw', 0.02))));
  out.push(layer('brow', pal.dark, (v) => v.region('brow', 0.012) * 0.55));
  out.push(region('ear', pal.dark, 0.85, 0.012));
  out.push(region('ear_inner', pal.inner, 0.9, 0.008));
  out.push(region('nose', pal.nose, 1, 0.006));
  out.push(region('nostril', [0, 0, 0], 1, 0.004));
  out.push(region('lipline', mixRgb(pal.nose, pal.dark, 0.5), 0.95, 0.006));
  out.push(region('tongue', pal.mouth, 1, 0.006));
  out.push(region('fang', [0.85, 0.82, 0.7], 1, 0.003));
  // eyes: dark lid ring, iris, pupil
  out.push(custom('eyes', (v) => {
    const ring = v.region('eye', 0.014);
    if (ring > 0) v.color = mixRgb(v.color, pal.dark, 0.7 * ring);
    const e = v.region('eye', 0.0018);
    if (e > 0) v.color = mixRgb(v.color, pal.eye, e);
    const pu = v.region('pupil', 0.0012);
    if (pu > 0) v.color = mixRgb(v.color, [0.01, 0.008, 0.008], pu);
  }));

  // ---- hair texture: flowing strands + clumps + guard-hair speckle (all baked at texel resolution)
  const flow = (v: { region(tag: string, soft?: number): number; n: Vec3 }): Vec3 => {
    const leg = clamp01(v.region('leg', 0.03));
    const tl = clamp01(v.region('tail', 0.03));
    const head = clamp01(v.region('head', 0.02));
    const base: Vec3 = [0, -0.25 * v.n[1] - 0.1, -1];
    const legDir: Vec3 = [0, -1, -0.15];
    const tailDir: Vec3 = [0, -0.5, -1];
    const headDir: Vec3 = [0, -0.15, 1];
    const mixv = (x: Vec3, y: Vec3, t: number): Vec3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
    return vnorm(mixv(mixv(mixv(base, legDir, leg), tailDir, tl), headDir, head * (1 - leg)));
  };
  out.push(strands({ flow, freq: 70 / s, stretch: 4, amount: 0.22, octaves: 2 }));
  out.push(strands({ flow, freq: 240 / s, stretch: 8, amount: 0.38, octaves: 3 }));
  // light hair tips: thin streaks along the flow on upward-facing fur
  out.push(strands({ flow, freq: 300 / s, stretch: 10, amount: 0.7, octaves: 1, tint: adjust(pal.light, 0.03, 0.5), mask: (v) => smoothstep(0.1, 0.8, v.n[1]) * torsoMask(v) * 0.4 }));
  out.push(furClumps({ freq: 30 / s, amount: 0.2, stretch: [1, 1, 0.4] }));
  out.push(furClumps({ freq: 60 / s, amount: 0.12, stretch: [1, 1, 0.5] }));
  out.push(grain(0.05, 140 / s));

  const shade: PaintLayer[] = [
    cavity(0.3, 0.1),
    bakeAo(0.7, [0.5, 0.45, 0.5]),
    hemi(rgb('#fff6e6'), rgb('#bba58a'), 0.55),
    rimTint(rgb('#ffe9c8'), { strength: 0.1 }),
  ];
  const emissive: PaintLayer[] | undefined = pal.spirit
    ? [fill([0, 0, 0]), region('spirit', pal.spirit, 1, 0.045), layer('spiritFade', pal.spirit, (v) => v.region('tail_tip', 0.05) * 0.5), region('eye', pal.spirit, 0.9, 0.003)]
    : undefined;
  return { albedo: out, shade, ...(emissive ? { emissive } : {}), ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
