// Flame ghost paint: the body (torso, arms, tail core) is a saturated orange-red base so the humanoid reads under the flames;
// flames brighten toward yellow roots and fall off to crimson tips; the skull is charred black so it is the focal point,
// with white-hot ember eyes. Glow is baked as near-1.0 albedo, the occlusion stack stays light, and the vertex normals are
// lifted toward +Y (game material is lit + opaque).
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, blotches, cavity, custom, fill, gradient, grain, hemi, layer, region, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, mixRgb, rgb } from '../../core/paint/painter.ts';

export function firePaint(textureSize: number): PaintSpec {
  const white = rgb('#fff6c8');
  const yellow = rgb('#ffd23a');
  const amber = rgb('#ffa21c');
  const orange = rgb('#ff7a10');
  const redOrange = rgb('#e8501a');
  const red = rgb('#d02208');
  const crimson = rgb('#821008');
  const char = rgb('#2e0905');
  const up: Vec3 = [0, 1, 0];
  const bodyMask = (v: { region(t: string, s?: number): number }): number => clamp01(v.region('tail', 0.03) + v.region('torso', 0.03) + v.region('arm', 0.03));

  const albedo: PaintLayer[] = [
    fill(orange),
    // body: saturated base, dark at the tail tip, amber at the shoulders; the white-hot colours are kept for flame roots and hands
    gradient([0, 1, 0], 0.1, 1.5, [[0, char], [0.14, crimson], [0.4, redOrange], [0.72, orange], [1, amber]], { warp: { freq: 6, amp: 0.1 }, mask: bodyMask }),
    // lava veins: bright cracks run through a darker crust (ridged noise stretched along the body), valleys shaded for structure
    custom('veins', (v) => {
      const m = bodyMask(v) * (1 - v.region('face', 0.01) * 0.3);
      if (m <= 0.05) return;
      const n1 = v.noise.ridged(v.p[0] * 7, v.p[1] * 3.2, v.p[2] * 7, { octaves: 3 });
      const n2 = v.noise.ridged(v.p[0] * 17 + 4, v.p[1] * 7, v.p[2] * 17, { octaves: 2 });
      const crust = smoothstep(0.55, 0.2, n1) * 0.55 * m;
      let c = mixRgb(v.color, crimson, crust);
      const vein = smoothstep(0.7, 0.88, n1) * m;
      const hair = smoothstep(0.78, 0.92, n2) * m * 0.5;
      c = mixRgb(c, yellow, Math.min(1, vein * 0.9 + hair));
      v.color = c;
    }),
    layer('coreShade', crimson, (v) => bodyMask(v) * smoothstep(0.08, -0.45, v.cavity) * 0.85),
    layer('coreLight', amber, (v) => bodyMask(v) * smoothstep(0.05, 0.5, v.cavity) * 0.6),
    layer('absLight', yellow, (v) => v.region('abs', 0.012) * smoothstep(0.0, 0.5, v.cavity) * 0.5),
    // tongues: root = yellow core, tip = red / crimson
    layer('froot', yellow, (v) => v.region('froot', 0.1) * 0.35),
    layer('frootHot', white, (v) => v.region('froot', 0.03) * 0.15 * (1 - bodyMask(v))),
    layer('ftip', red, (v) => v.region('ftip', 0.13) * 0.9),
    layer('ftipDark', crimson, (v) => v.region('ftip', 0.06) * 0.85),
    strands({ flow: () => up, freq: 38, stretch: 9, amount: 0.3, octaves: 2, tint: yellow, mask: (v) => v.region('flame', 0.01) * (1 - bodyMask(v) * 0.7) }),
    strands({ flow: () => up, freq: 70, stretch: 12, amount: 0.3, octaves: 2 }),
    layer('edgeRed', red, (v) => smoothstep(0.06, 0.5, v.cavity) * 0.65 * v.region('flame', 0.01)),
    // charred soot patches for value contrast
    blotches(char, { freq: 8, threshold: 0.35, softness: 0.2, strength: 0.6, octaves: 3, stretch: [1, 0.6, 1], seedOffset: 9, mask: (v) => clamp01(v.region('tail', 0.03) * 0.7 + v.region('wisp', 0.01) + v.region('cuff', 0.01)) }),
    // face: same lava skin, warm cheeks, dark brows, black sockets, dark scream with a glowing throat, slit ember eyes
    layer('faceHot', amber, (v) => v.region('face', 0.012) * smoothstep(0.1, 0.7, v.cavity) * 0.7),
    layer('brow', rgb('#4a0f05'), (v) => v.region('brow', 0.01) * 0.85),
    layer('ear', crimson, (v) => v.region('ear', 0.01) * 0.6),
    region('socket', rgb('#0d0302'), 1, 0.006),
    region('mouth', rgb('#2a0a05'), 1, 0.005),
    region('glint', rgb('#ffe27a'), 1, 0.004),
    // hands: warm palms, dark claw fingers
    layer('hand', amber, (v) => v.region('hand', 0.012) * 0.55),
    layer('finger', rgb('#5a1608'), (v) => v.region('finger', 0.008) * 0.65),
    layer('bracer', yellow, (v) => v.region('bracer', 0.006) * 0.85),
    layer('glyph', white, (v) => v.region('glyph', 0.006) * 0.9),
    // embers: white-hot cinders
    layer('ember', white, (v) => v.region('ember', 0.006) * 0.9),
    layer('emberEdge', orange, (v) => v.region('ember', 0.006) * smoothstep(0.1, 0.5, v.cavity) * 0.9),
    grain(0.06, 150),
  ];

  const shade: PaintLayer[] = [
    cavity(0.14, 0.04),
    bakeAo(0.38, [0.8, 0.45, 0.4]),
    hemi(rgb('#ffffff'), rgb('#ffcfa0'), 0.3),
    layer('glowKeep', rgb('#ffffff'), (v) => clamp01(v.region('glint', 0.004) + v.region('ember', 0.005)), 'mix'),
  ];

  return { albedo, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 92 } } : {}) };
}
