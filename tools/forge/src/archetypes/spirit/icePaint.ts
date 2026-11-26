// Ice wraith paint: faceted gem banding driven by the surface normal, directional edge lines (bright where a facet turns
// toward the light, deep navy where it turns away), frost on convex edges, deep-blue core in the crevices, snow caps,
// cyan rune glow on the ring, white-hot eyes/gem and a dark void face. Opaque + lit in game, so the "translucency" is
// faked with value structure: dark deep core -> mid facets -> near-white edges.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import { bakeAo, blotches, cavity, custom, fill, gradient, grain, hemi, layer, region, stripes } from '../../core/paint/layers.ts';
import { type PaintLayer, type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';

export function icePaint(textureSize: number): PaintSpec {
  const navy = rgb('#081c58');
  const deep = rgb('#153a9a');
  const mid = rgb('#3a86dc');
  const pale = rgb('#a9dcff');
  const white = rgb('#f2fbff');
  const teal = rgb('#2fc4d8');
  const violet = rgb('#5a6fe0');
  const L1 = vnorm([0.35, 0.8, 0.5]);
  const L2 = vnorm([-0.7, 0.2, -0.4]);
  const dot = (n: readonly number[], l: readonly number[]): number => n[0]! * l[0]! + n[1]! * l[1]! + n[2]! * l[2]!;

  const albedo: PaintLayer[] = [
    fill(mid),
    // vertical depth: robe tip is deep blue, shoulders/head pale
    gradient([0, 1, 0], 0.15, 1.6, [[0, deep], [0.35, mixRgb(deep, mid, 0.6)], [0.7, mid], [1, pale]], { warp: { freq: 5, amp: 0.1 } }),
    // gem facets: brightness stepped by quantised normal direction (hard bands = cut facets), hue drifts cyan <-> violet
    custom('facets', (v) => {
      const n = v.n;
      const d1 = dot(n, L1), d2 = dot(n, L2);
      const qx = Math.floor(n[0] * 2.6 + 8), qy = Math.floor(n[1] * 2.6 + 8), qz = Math.floor(n[2] * 2.6 + 8);
      const key = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) >>> 0;
      const rnd = (key % 1000) / 1000;
      const lit = 0.5 + 0.75 * smoothstep(-0.5, 0.9, d1) + 0.2 * smoothstep(0.2, 0.9, d2) + (rnd - 0.5) * 0.34;
      const c: Rgb = [v.color[0] * lit, v.color[1] * lit, v.color[2] * lit];
      const hue = rnd < 0.33 ? teal : rnd < 0.66 ? violet : mid;
      v.color = mixRgb(c, [hue[0] * lit, hue[1] * lit, hue[2] * lit], 0.28);
    }),
    // cloudy frosted interior: soft low-frequency mottling + thin refraction streaks
    blotches(pale, { freq: 7, threshold: 0.0, softness: 0.35, strength: 0.28, octaves: 3, stretch: [1, 1.6, 1], seedOffset: 5 }),
    blotches(navy, { freq: 11, threshold: 0.25, softness: 0.3, strength: 0.32, octaves: 3, seedOffset: 17 }),
    stripes(white, { axis: [0.7, 0.5, 0.3], period: 0.085, duty: 0.06, warpAmp: 0.6, warpFreq: 6, softness: 0.5, strength: 0.4, mask: (v) => smoothstep(0.2, 0.7, v.region('ice', 0.02)) * (0.4 + 0.6 * smoothstep(-0.2, 0.8, dot(v.n, L1))) }),
    // crevices: deep core glow
    layer('core', navy, (v) => smoothstep(0.05, -0.55, v.cavity) * 0.65),
    // edge lines: bright where the facet turns to the light, deep navy on the shadow side
    custom('edges', (v) => {
      const e = smoothstep(0.1, 0.55, v.cavity);
      if (e <= 0) return;
      const d = dot(v.n, L1);
      const col = mixRgb(navy, white, smoothstep(-0.1, 0.55, d));
      v.color = mixRgb(v.color, col, clamp01(e * 0.85));
    }),
    // frost patches on upward faces
    blotches(white, { freq: 9, threshold: 0.28, softness: 0.2, strength: 0.7, octaves: 3, mask: (v) => smoothstep(0.25, 0.9, v.n[1]) * 0.85, seedOffset: 31 }),
    // snow caps
    region('snow', rgb('#f7fcff'), 1, 0.01),
    layer('snowShade', rgb('#a9c9ea'), (v) => v.region('snow', 0.01) * smoothstep(0.2, -0.8, v.n[1]) * 0.85),
    // glowing crown / claws / orbit tips
    layer('tips', white, (v) => clamp01(v.region('claw', 0.005) * 0.5 + v.region('crown', 0.005) * 0.35 + v.region('shard', 0.006) * 0.5)),
    layer('shardCore', teal, (v) => v.region('shard', 0.006) * smoothstep(0.1, -0.3, v.cavity) * 0.5 + v.region('shard', 0.006) * 0.2),
    // ring: darker steel-blue band with cyan runes
    layer('ringBase', rgb('#2b6fb8'), (v) => v.region('ring', 0.01) * 0.85),
    custom('runes', (v) => {
      const r = v.region('ring', 0.004);
      if (r <= 0.1) return;
      const ang = Math.atan2(v.p[0], v.p[2]);
      const seg = (ang / (Math.PI * 2)) * 24;
      const f = seg - Math.floor(seg);
      const gate = smoothstep(0.1, 0.2, f) * (1 - smoothstep(0.65, 0.75, f));
      const g = v.noise.fbm(ang * 14, v.p[1] * 90, 0, { octaves: 2 });
      const glow = gate * smoothstep(-0.05, 0.12, g) * r * smoothstep(0.1, 0.8, Math.abs(v.n[1]));
      v.color = mixRgb(v.color, rgb('#9ff3ff'), clamp01(glow));
    }),
    layer('studGlow', rgb('#bff8ff'), (v) => v.region('stud', 0.004) * smoothstep(0.0, 0.5, v.cavity + 0.4) * 0.7),
    // chest gem: cyan stone with a white-hot heart
    layer('gem', rgb('#37d6f2'), (v) => v.region('gem', 0.004)),
    layer('gemHeart', rgb('#f4ffff'), (v) => v.region('gem', 0.004) * smoothstep(0.35, 0.8, v.n[2])),
    // face: a dark hollow in the helm with white-hot slit eyes and a cold glowing mouth line (eyes read at gameplay distance)
    layer('voidDeep', rgb('#06183c'), (v) => v.region('void', 0.006)),
    layer('voidRim', rgb('#1d5cb0'), (v) => v.region('void', 0.006) * smoothstep(0.1, 0.9, v.n[2] * 0.8 + 0.2) * 0.8),
    region('mouthvoid', rgb('#9eefff'), 1, 0.004),
    region('eye', rgb('#f4ffff'), 1, 0.003),
    grain(0.05, 160),
  ];

  const shade: PaintLayer[] = [
    cavity(0.16, 0.05),
    bakeAo(0.5, [0.45, 0.55, 0.85]),
    hemi(rgb('#ffffff'), rgb('#9db5d8'), 0.45),
    // glow sources are never shaded by occlusion
    layer('glowLift', rgb('#ffffff'), (v) => clamp01(v.region('eye', 0.004) + 0.8 * v.region('mouthvoid', 0.004) + v.region('gem', 0.004) + 0.8 * v.region('shard', 0.005) + 0.6 * v.region('stud', 0.004)), 'mix'),
  ];
  return { albedo, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 92 } } : {}) };
}
