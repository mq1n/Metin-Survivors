// Corpse ghost paint: pale aged-linen shroud (so the game's rose tint for the 'angry' variant multiplies cleanly), soiled to
// a dark misty grey toward the ragged hem, brown/green/blood stains, ivory bone through the torn chest, grey-green skin on the
// arms, a yellow paper talisman with red ink glyphs, black sockets with sickly glowing pinpoint eyes.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, blotches, cavity, custom, fill, gradient, grain, hemi, layer, region, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, mixRgb, rgb } from '../../core/paint/painter.ts';

export function corpsePaint(textureSize: number): PaintSpec {
  const linen = rgb('#c9c1a8');
  const dirty = rgb('#938b72');
  const grime = rgb('#4a4b43');
  const mist = rgb('#2b3338');
  const stain = rgb('#6b4b2f');
  const mildew = rgb('#6e8764');
  const blood = rgb('#6a1a16');
  const bone = rgb('#e2dac0');
  const skin = rgb('#98a692');
  const down: Vec3 = [0, -1, 0];
  const clothMask = (v: { region(t: string, s?: number): number }): number => clamp01(v.region('cloth', 0.012));

  const albedo: PaintLayer[] = [
    fill(linen),
    // soiling gradient: clean at the hood, filthy toward the hem, dissolving into dark mist
    gradient([0, 1, 0], 0.2, 1.3, [[0, mist], [0.2, grime], [0.5, dirty], [0.85, linen], [1, linen]], { warp: { freq: 6, amp: 0.08 }, mask: clothMask }),
    // woven thread streaks + folds (vertical)
    strands({ flow: () => down, freq: 90, stretch: 8, amount: 0.2, octaves: 2 }),
    strands({ flow: () => down, freq: 300, stretch: 14, amount: 0.3, octaves: 2 }),
    // stains
    blotches(stain, { freq: 7, threshold: 0.18, softness: 0.22, strength: 0.7, octaves: 3, stretch: [1, 0.5, 1], seedOffset: 3, mask: clothMask }),
    blotches(mildew, { freq: 11, threshold: 0.3, softness: 0.2, strength: 0.6, octaves: 3, seedOffset: 21, mask: (v) => clothMask(v) * smoothstep(1.15, 0.6, v.p[1]) }),
    layer('blood', blood, (v) => clamp01(v.region('tear', 0.05) * 0.8) * (0.5 + 0.5 * v.noise.fbm(v.p[0] * 30, v.p[1] * 30, v.p[2] * 30, { octaves: 2 })) * clothMask(v)),
    layer('bloodDrips', blood, (v) => clothMask(v) * smoothstep(0.35, 0.6, v.noise.fbm(v.p[0] * 40, v.p[1] * 5, v.p[2] * 40, { octaves: 2 })) * smoothstep(1.0, 0.8, v.p[1]) * smoothstep(0.4, 0.8, v.p[1]) * 0.55),
    // ragged tips: burnt / rotted dark
    layer('ctip', mist, (v) => v.region('ctip', 0.09) * 0.85),
    // cloth folds painted at texel resolution (the tri budget is spent on silhouette): ridged valleys darken, ridges catch light
    custom('folds', (v) => {
      const cm = clamp01(v.region('cloth', 0.012)) * (1 - v.region('hood', 0.01) * 0.0);
      if (cm <= 0.05) return;
      const g1 = v.noise.ridged(v.p[0] * 14, v.p[1] * 3.2, v.p[2] * 14, { octaves: 2 });
      const g2 = v.noise.ridged(v.p[0] * 34, v.p[1] * 7, v.p[2] * 34, { octaves: 2 });
      const k = ((g1 - 0.5) * 0.7 + (g2 - 0.5) * 0.35) * cm;
      v.color = [v.color[0] * (1 + k), v.color[1] * (1 + k), v.color[2] * (1 + k)];
    }),
    layer('ctipEdge', rgb('#171a1a'), (v) => v.region('ctip', 0.045) * 0.9),
    layer('sash', rgb('#5b4a3a'), (v) => v.region('sash', 0.006) * 0.9),
    // the hood is a different, darker mourning cloth with a dark rim around the face so the head separates from the torso at distance
    layer('hoodTone', rgb('#7d7864'), (v) => v.region('hood', 0.01) * 0.75 * clothMask(v)),
    layer('hoodRim', rgb('#1c1d1c'), (v) => v.region('hoodinner', 0.04) * 0.6 * clothMask(v)),
    layer('hoodinner', rgb('#26272a'), (v) => v.region('hoodinner', 0.012) * 0.9 * clothMask(v)),
    // bones: torn-open chest, spine knobs, skull
    layer('bone', bone, (v) => clamp01(v.region('bone', 0.008) - 0.6 * clothMask(v))),
    layer('boneGrime', rgb('#8a7c5c'), (v) => v.region('bone', 0.01) * smoothstep(0.1, -0.5, v.cavity) * 0.8),
    layer('arm', skin, (v) => v.region('arm', 0.01) * (1 - v.region('bone', 0.002) * 0.4) * 0.85),
    layer('armBone', bone, (v) => v.region('joint', 0.01) * 0.8),
    layer('claw', rgb('#3a342a'), (v) => v.region('claw', 0.006) * smoothstep(0.0, 0.6, v.p[1] * 0 + 0.6) * 0.8),
    // face
    layer('face', bone, (v) => v.region('face', 0.006)),
    layer('faceShadow', rgb('#7a6e54'), (v) => v.region('face', 0.01) * smoothstep(0.05, -0.5, v.cavity) * 0.8),
    region('socket', rgb('#080a0a'), 1, 0.005),
    region('eye', rgb('#b8ffdc'), 1, 0.003),
    region('tooth', rgb('#e4d9a6'), 1, 0.002),
    layer('toothRoot', rgb('#7b6b3e'), (v) => v.region('tooth', 0.002) * smoothstep(0.7, 0.1, v.n[1] * 0.5 + 0.5) * 0.5),
    region('jaw', bone, 0.9, 0.006),
    // talisman: yellow paper with red ink columns and seal bars
    layer('tali', rgb('#e7cf86'), (v) => v.region('tali', 0.004)),
    custom('glyphs', (v) => {
      const m = v.region('tali', 0.002);
      if (m < 0.2) return;
      const t = (1.335 - v.p[1]) / 0.135;
      const g = v.noise.fbm(v.p[0] * 260, v.p[1] * 120, 3.1, { octaves: 2 });
      const stroke = smoothstep(0.02, 0.16, g) * smoothstep(0.06, 0.12, t) * (1 - smoothstep(0.88, 0.95, t));
      const bar = (1 - smoothstep(0.03, 0.06, Math.abs(t - 0.07))) + (1 - smoothstep(0.03, 0.06, Math.abs(t - 0.93)));
      v.color = mixRgb(v.color, rgb('#b3201a'), clamp01((stroke * 0.85 + bar) * m));
    }),
    grain(0.06, 150),
  ];

  const shade: PaintLayer[] = [
    cavity(0.25, 0.06),
    bakeAo(0.7, [0.42, 0.44, 0.55]),
    hemi(rgb('#ffffff'), rgb('#aab3c6'), 0.45),
    layer('glowKeep', rgb('#ffffff'), (v) => clamp01(v.region('eye', 0.004)), 'mix'),
  ];
  return { albedo, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 92 } } : {}) };
}
