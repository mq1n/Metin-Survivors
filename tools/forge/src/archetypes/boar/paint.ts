// Boar paint: golden bristle saddle hanging in flame-shaped tongues over a dark-brown hide, dark dorsal band, pale belly, dark mask and
// stockings, ivory tusks, pale hooves, bold directional strand texture + hide creases (baked into the albedo texture). AO/cavity/hemi/rim are
// the per-vertex shade multiplier (COLOR_0). The base stays light/mid on purpose: the game multiplies a per-enemy tint into it (red boars,
// hungry tan boars, the boss), so every zone keeps channel headroom and the saddle carries the warm hue the red tints turn into a red boar.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, bones, cavity, custom, fill, furClumps, gradient, grain, hemi, layer, region, rimTint, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';

export function makePaint(a: Anatomy, textureSize = 1024): PaintSpec {
  const pal = a.p.palette;
  const s = a.s;
  const belly = 0.36 * s;
  const withers = a.withersY;
  type RV = { region(tag: string, soft?: number): number };
  const bodyMask = (v: RV): number => Math.max(v.region('torso', 0.03), v.region('neck', 0.03), v.region('bristle', 0.01), v.region('tail', 0.02), v.region('tuft', 0.01));
  const face = mixRgb(pal.dark, pal.hide, 0.2);
  const out: PaintLayer[] = [fill(pal.hide)];

  // ---- coat: pale belly under a dark-brown hide
  out.push(
    gradient([0, 1, 0], belly, 0.56 * s, [
      [0, pal.belly],
      [0.28, mixRgb(pal.belly, pal.hide, 0.65)],
      [0.55, mixRgb(pal.hide, pal.dark, 0.25)],
      [1, mixRgb(pal.hide, pal.dark, 0.35)],
    ], { warp: { freq: 7 / s, amp: 0.12 }, mask: bodyMask }),
  );
  // mottled darker hide on the flanks and pale guard-hair grizzle
  out.push(layer('mottle', pal.dark, (v) => {
    const n = v.noise.fbm(v.p[0] * 9 / s, v.p[1] * 14 / s, v.p[2] * 8 / s, { octaves: 3 });
    return smoothstep(0.0, 0.4, n) * 0.6 * smoothstep(0.62 * s, 0.45 * s, v.p[1]) * bodyMask(v);
  }));

  // ---- bristle saddle: golden hair over the shoulders, nape, back and rump, ragged tongues hanging down the flanks
  out.push(custom('saddle', (v) => {
    const m = bodyMask(v);
    if (m <= 0) return;
    const tongue = v.noise.fbm(v.p[0] * 20 / s, v.p[1] * 4.5 / s, v.p[2] * 20 / s, { octaves: 2 });
    const warp = v.noise.noise(v.p[0] * 8 / s, v.p[1] * 8 / s, v.p[2] * 8 / s);
    const t = (v.p[1] - 0.46 * s) / (withers + 0.04 * s - 0.46 * s) + 0.34 * tongue + 0.08 * warp;
    const k = smoothstep(0.36, 0.62, t) * m;
    if (k > 0) v.color = mixRgb(v.color, pal.mane, k);
    // darker bristle roots under the saddle and a pale rim of hair tips along its upper edge
    const edge = smoothstep(0.62, 0.86, t) * (1 - smoothstep(0.86, 1.1, t));
    if (edge > 0) v.color = mixRgb(v.color, adjust(pal.mane, 0.06, 0.9), edge * 0.5 * m);
  }));
  out.push(layer('dorsal', pal.ridge, (v) => {
    const band = smoothstep(0.08 * s, 0.015 * s, Math.abs(v.p[0])) * smoothstep(0.64 * s, 0.7 * s, v.p[1]);
    const brk = 0.55 + 0.45 * v.noise.noise(v.p[2] * 14 / s, v.p[0] * 20 / s, 3.1);
    return band * brk * 0.95 * Math.max(v.region('torso', 0.03), v.region('neck', 0.03));
  }));

  // ---- legs: dark stockings above pale pasterns, dark joints, pale hooves
  out.push(gradient([0, 1, 0], 0.07 * s, 0.42 * s, [[0, mixRgb(pal.belly, pal.dark, 0.35)], [0.3, pal.dark], [0.75, mixRgb(pal.dark, pal.hide, 0.5)], [1, mixRgb(pal.hide, pal.dark, 0.3)]], { mask: (v) => v.region('leg', 0.025) }));
  out.push(bones(['forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'toe_l', 'toe_r'], pal.dark, 0.5, [0.3, 0.9]));
  out.push(region('joint', mixRgb(pal.dark, pal.hoofDark, 0.5), 0.5, 0.012));
  out.push(layer('pastern', mixRgb(pal.belly, pal.hoof, 0.5), (v) => v.region('leg', 0.02) * smoothstep(0.1 * s, 0.05 * s, v.p[1]) * 0.6));
  out.push(region('tuft', mixRgb(pal.mane, pal.tip, 0.25), 0.7, 0.012));
  out.push(region('hoof', pal.hoof, 1, 0.004));
  out.push(region('dew', pal.hoofDark, 0.9, 0.004));
  out.push(layer('hoofTip', pal.hoofDark, (v) => v.region('hoof', 0.003) * smoothstep(0.034 * s, 0.014 * s, v.p[1]) * 0.9));
  out.push(layer('hoofTop', mixRgb(pal.hoof, pal.dark, 0.5), (v) => v.region('hoof', 0.003) * smoothstep(0.052 * s, 0.078 * s, v.p[1]) * 0.7));
  // dark cleft between the two toes (the leg centre lines are x = 0.16 s in front, 0.15 s behind)
  out.push(layer('hoofSplit', pal.hoofDark, (v) => {
    const dx = Math.abs(Math.abs(v.p[0]) - (v.p[2] > 0 ? 0.16 : 0.15) * s);
    return v.region('hoof', 0.003) * smoothstep(0.0085 * s, 0.002 * s, dx) * 0.95;
  }));

  // ---- tail: dark cord, bristle tassel
  out.push(region('tail_body', pal.dark, 0.7, 0.02));
  out.push(region('tail_tip', mixRgb(pal.mane, pal.tip, 0.3), 0.95, 0.03));

  // ---- head: dark mask, warm-brown snout flanks, dark rhinarium, paler jaw, dark red mouth interior
  out.push(region('head', face, 0.9, 0.025));
  out.push(region('cheek', mixRgb(pal.cheek, face, 0.55), 0.6, 0.03));
  out.push(region('snout', mixRgb(pal.cheek, face, 0.5), 0.6, 0.025));
  out.push(layer('snoutTop', pal.dark, (v) => v.region('snout', 0.02) * smoothstep(0.45, 0.95, v.n[1]) * 0.6));
  out.push(region('flew', mixRgb(pal.cheek, face, 0.35), 0.8, 0.015));
  out.push(region('jaw', mixRgb(pal.cheek, pal.belly, 0.3), 0.8, 0.02));
  out.push(layer('mouthRoof', pal.mouth, (v) => Math.max(v.region('snout', 0.01), v.region('flew', 0.01)) * smoothstep(-0.35, -0.8, v.n[1]) * 0.85));
  out.push(layer('mouthFloor', pal.mouth, (v) => v.region('jaw', 0.008) * smoothstep(0.3, 0.75, v.n[1]) * 0.85));
  out.push(layer('throat', pal.belly, (v) => v.region('throat', 0.05) * 0.55));
  out.push(layer('brow', pal.ridge, (v) => v.region('brow', 0.012) * 0.8));
  out.push(layer('skullCrest', pal.ridge, (v) => v.region('skull', 0.012) * smoothstep(0.55, 0.95, v.n[1]) * 0.55));
  out.push(region('ear', mixRgb(pal.dark, pal.hide, 0.3), 0.9, 0.012));
  out.push(region('ear_inner', pal.inner, 0.9, 0.008));
  out.push(region('nose_rim', mixRgb(pal.snout, pal.dark, 0.4), 0.9, 0.006));
  out.push(region('nose', pal.snout, 1, 0.006));
  out.push(region('nostril', [0, 0, 0], 1, 0.004));
  out.push(region('lipline', mixRgb(pal.nostril, pal.dark, 0.5), 0.95, 0.005));
  out.push(region('tongue', pal.mouth, 1, 0.006));
  out.push(region('tusk', pal.tusk, 1, 0.003));
  out.push(layer('tuskStain', mixRgb(pal.tusk, pal.hoofDark, 0.55), (v) => v.region('tusk', 0.002) * smoothstep(0.85, 0.35, v.ao) * 0.7));
  // bristle blades: mane colour with dark roots and pale tips (AO = how far a vertex stands off the body)
  out.push(layer('bristle', mixRgb(pal.mane, pal.tip, 0.12), (v) => v.region('bristle', 0.002) * 0.9));
  out.push(layer('bristleRoot', pal.ridge, (v) => v.region('bristle', 0.002) * smoothstep(0.55, 0.15, v.ao) * 0.55));
  out.push(layer('bristleTip', pal.tip, (v) => v.region('bristle', 0.002) * smoothstep(0.7, 0.97, v.ao) * 0.6));
  out.push(layer('ruffBristle', mixRgb(pal.cheek, pal.tip, 0.45), (v) => v.region('ruff', 0.002) * 0.8));
  // eyes: thin dark lid ring, bright amber eyeball, black pupil
  out.push(custom('eyes', (v) => {
    const ring = v.region('eye', 0.004);
    if (ring > 0) v.color = mixRgb(v.color, pal.ridge, 0.9 * ring);
    const e = v.region('eye', 0.0012);
    if (e > 0) v.color = mixRgb(v.color, pal.eye, e);
    const pu = v.region('pupil', 0.0018);
    if (pu > 0) v.color = mixRgb(v.color, [0.01, 0.008, 0.008], pu);
  }));

  // ---- hide creases: dark folds across the shoulder shield, throat and nape (thin noise zero-crossings, stretched around the body)
  out.push(custom('creases', (v) => {
    const m = Math.max(v.region('shield', 0.03), v.region('throat', 0.03), v.region('nape', 0.03), v.region('haunch', 0.03) * 0.6);
    if (m <= 0.01) return;
    const n = Math.abs(v.noise.fbm(v.p[0] * 10 / s, v.p[1] * 34 / s, v.p[2] * 22 / s, { octaves: 2 }));
    const k = 1 - 0.55 * smoothstep(0.1, 0.0, n) * m;
    v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
  }));

  // ---- hair texture: bold directional strands + clumps + guard-hair speckle (baked at texel resolution)
  const flow = (v: { region(tag: string, soft?: number): number; n: Vec3 }): Vec3 => {
    const leg = clamp01(v.region('leg', 0.03));
    const tl = clamp01(v.region('tail', 0.03));
    const head = clamp01(v.region('head', 0.02));
    const bris = clamp01(v.region('bristle', 0.01));
    const base: Vec3 = [0, -0.45 * v.n[1] - 0.15, -1];
    const legDir: Vec3 = [0, -1, -0.1];
    const tailDir: Vec3 = [0, -0.7, -1];
    const headDir: Vec3 = [0, -0.2, 1];
    const brisDir: Vec3 = [0, 0.5, -0.9];
    const mixv = (x: Vec3, y: Vec3, t: number): Vec3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
    return vnorm(mixv(mixv(mixv(mixv(base, legDir, leg), tailDir, tl), headDir, head * (1 - leg)), brisDir, bris));
  };
  const saddleMask = (v: RV & { p: Vec3; n: Vec3 }): number => smoothstep(0.48 * s, 0.62 * s, v.p[1]) * bodyMask(v);
  out.push(strands({ flow, freq: 46 / s, stretch: 6, amount: 0.34, octaves: 2 }));
  out.push(strands({ flow, freq: 120 / s, stretch: 7, amount: 0.4, octaves: 2 }));
  out.push(strands({ flow, freq: 240 / s, stretch: 10, amount: 0.3, octaves: 2 }));
  // rust and pale guard-hair streaks run through the golden saddle
  out.push(strands({ flow, freq: 60 / s, stretch: 9, amount: 1.9, octaves: 1, tint: pal.rust, mask: (v) => saddleMask(v) * 0.95 }));
  out.push(strands({ flow, freq: 110 / s, stretch: 9, amount: 1.4, octaves: 1, tint: mixRgb(pal.rust, pal.ridge, 0.5), mask: (v) => saddleMask(v) * 0.6 }));
  out.push(strands({ flow, freq: 150 / s, stretch: 10, amount: 1.2, octaves: 1, tint: adjust(pal.tip, 0.04, 0.55), mask: (v) => saddleMask(v) * 0.75 }));
  out.push(strands({ flow, freq: 120 / s, stretch: 9, amount: 1.0, octaves: 1, tint: pal.ridge, mask: (v) => smoothstep(0.58 * s, 0.4 * s, v.p[1]) * bodyMask(v) * 0.4 }));
  out.push(furClumps({ freq: 26 / s, amount: 0.22, stretch: [1, 1, 0.4] }));
  out.push(furClumps({ freq: 58 / s, amount: 0.12, stretch: [1, 1, 0.5] }));
  out.push(grain(0.05, 140 / s));

  const shade: PaintLayer[] = [
    cavity(0.3, 0.14),
    bakeAo(0.6, [0.52, 0.45, 0.5]),
    hemi(rgb('#fff6e4'), rgb('#bba68a'), 0.5),
    rimTint(rgb('#ffe6c4'), { strength: 0.1 }),
  ];
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
