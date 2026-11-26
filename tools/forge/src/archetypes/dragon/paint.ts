// Dragon paint: hand-painted look baked per texel. Albedo = scale cells (outlined, lit tops), gold dorsal ridge, pale belly scutes, ivory horns/claws,
// veined wing membrane, glowing eyes. Emissive = molten cracks on throat / chest / belly / thighs, hot mouth, eyes, wing-root veins.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, type Vec3 } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, hemi, rimTint } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';
import { type Membrane, sampleMembrane } from './membrane.ts';

/** body-zone masks shared by albedo + emissive stacks */
function zones(v: PaintVertex) {
  const torso = Math.max(v.region('torso', 0.12), v.region('keel', 0.12));
  const neck = v.region('neck', 0.1);
  const tail = v.region('tail', 0.1);
  return { torso, neck, tail, body: Math.max(torso, neck, tail) };
}

export function makePaint(a: Anatomy, membranes: Membrane[], textureSize: number): PaintSpec {
  const pal = a.p.palette;
  const s = a.s;
  const dark = rgb('#1c0604');
  const lerp = mixRgb;

  // ---- molten crack field (shared): thin zero-crossings of 3-D noise, branching at two scales
  const crack = (v: PaintVertex): { core: number; wide: number; zone: number } => {
    const z = zones(v);
    const throat = v.region('throat', 0.2);
    const keel = v.region('keel', 0.25);
    const down = smoothstep(0.15, -0.55, v.n[1]);
    const haunch = v.region('haunch', 0.1) * smoothstep(0.3, -0.4, v.n[1]);
    const flank = z.torso * smoothstep(0.65, 0.2, Math.abs(v.n[1])) * smoothstep(-0.1, 0.35, v.noise.fbm(v.p[0] * 0.5 / s, v.p[1] * 0.5 / s, v.p[2] * 0.5 / s, { octaves: 2 }));
    const zone = clamp01(Math.max(throat * 0.95, keel * 0.9, z.torso * down * 0.75, z.neck * down * 0.7, z.tail * down * 0.35, haunch * 0.4, flank * 0.55, v.region('cheek', 0.05) * 0.12));
    if (zone <= 0.01) return { core: 0, wide: 0, zone: 0 };
    const f = 1.5 / s;
    const warp = 0.45 * v.noise.noise(v.p[0] * 0.9 / s, v.p[1] * 0.9 / s, v.p[2] * 0.9 / s);
    const n1 = Math.abs(v.noise.noise(v.p[0] * f + warp, v.p[1] * f * 1.1, v.p[2] * f - warp));
    const n2 = Math.abs(v.noise.noise(v.p[0] * f * 2.3 + 11, v.p[1] * f * 2.3, v.p[2] * f * 2.3 - 5));
    const w = 0.16 + 0.07 * throat;
    const d = Math.min(n1, n2 * 1.6);
    const core = (1 - smoothstep(w * 0.3, w, d)) * zone;
    const wide = (1 - smoothstep(w, w * 2.0, d)) * zone;
    return { core, wide, zone };
  };

  // ---- voronoi scale cells: outlined, brightness-varied, rounded highlight at the cell centre
  const scaleCells = (v: PaintVertex, base: Rgb, strength: number): Rgb => {
    const small = v.region('head', 0.02) > 0.5;
    const mid = v.region('neck', 0.02) > 0.5 || v.region('leg', 0.02) > 0.5 || v.region('tail', 0.02) > 0.5;
    const f = (small ? 12 : mid ? 7 : 4.6) / s;
    const c = v.noise.voronoi(v.p[0] * f, v.p[1] * f * 1.15, v.p[2] * f * 0.9);
    const edge = smoothstep(0.0, 0.2, c.f2 - c.f1);
    const dome = 1 - clamp01(c.f1 * 1.5);
    const k = 1 + (c.id - 0.5) * 0.6 * strength + (dome - 0.5) * 0.55 * strength;
    const lit: Rgb = [base[0] * k, base[1] * k, base[2] * k];
    return lerp(mixRgb(lit, dark, 0.55 * strength), lit, edge);
  };

  const albedo: PaintLayer[] = [fill(pal.scale)];

  // 1. main hide: dark flanks, scale cells everywhere on the body
  albedo.push(custom('hide', (v) => {
    const z = zones(v);
    const up = smoothstep(-0.2, 0.85, v.n[1]);
    let base = lerp(lerp(pal.scaleDark, pal.scale, 0.55), pal.scaleLight, up * 0.5);
    // slow mottling so big surfaces don't read as one tone
    const m = v.noise.fbm(v.p[0] * 0.55 / s, v.p[1] * 0.55 / s, v.p[2] * 0.55 / s, { octaves: 3 });
    base = lerp(base, m > 0 ? pal.scaleLight : pal.scaleDark, Math.abs(m) * 0.4);
    // legs and head: slightly darker, heavier scales
    base = lerp(base, pal.scaleDark, Math.max(v.region('leg', 0.05), v.region('head', 0.03) * 0.3) * 0.35);
    v.color = scaleCells(v, base, 0.85 + 0.15 * z.body);
  }));

  // 2. belly scutes + pale underside on torso, neck, tail, throat
  albedo.push(custom('belly', (v) => {
    const z = zones(v);
    const under = smoothstep(-0.05, -0.62, v.n[1]);
    const a_ = clamp01(Math.max(z.torso * 0.95, z.neck * 0.85, z.tail * 0.75, v.region('throat', 0.1)) * under);
    if (a_ <= 0.01) return;
    // transverse scutes: bands across the body (axis = body length, curving along neck/tail via distance in z/y)
    const along = v.p[2] + Math.min(0, v.p[2] + 2.8 * s) * 0.0 + v.p[1] * 0.55 * (v.region('neck', 0.05) > 0.5 ? 1 : 0);
    const per = 0.34 * s;
    const t = along / per - Math.floor(along / per);
    const band = smoothstep(0.0, 0.1, t) * (1 - smoothstep(0.86, 1.0, t));
    let c = lerp(pal.belly, adjust(pal.belly, -0.06, 1.1), 1 - band);
    c = lerp(c, adjust(pal.belly, 0.07, 0.8), band * 0.5 * (0.5 + 0.5 * v.noise.noise(v.p[0] * 3, v.p[1] * 3, v.p[2] * 3)));
    v.color = lerp(v.color, c, a_);
  }));

  // 3. dorsal ridge: warm gold band down the centre line of back, neck and tail, plates with dark roots
  albedo.push(custom('dorsal', (v) => {
    const z = zones(v);
    const top = smoothstep(0.25, 0.8, v.n[1]);
    const half = (0.1 + 0.34 * z.torso + 0.1 * z.neck + 0.06 * z.tail) * s;
    const ax = Math.abs(v.p[0]);
    const ridge = (1 - smoothstep(half * 0.6, half * 1.3, ax)) * top * z.body;
    if (ridge > 0.01) {
      const stripe = lerp(lerp(pal.scaleLight, pal.gold, 0.65), pal.gold, 0.3 * v.noise.noise(v.p[0] * 5, v.p[1] * 5, v.p[2] * 5) + 0.3);
      const cells = scaleCells(v, stripe, 0.7);
      v.color = lerp(v.color, cells, ridge * 0.9);
    }
    const pl = v.region('plate', 0.015);
    if (pl > 0.01) {
      // dark root -> bone/gold tip: height above the local body surface is approximated by the SDF-free vertical gradient inside the plate
      const tipT = smoothstep(0.45, 0.95, v.ao);
      v.color = lerp(v.color, lerp(lerp(pal.scaleDark, pal.scale, 0.5), lerp(pal.gold, pal.hornTip, 0.22), tipT), pl * 0.92);
    }
  }));

  // 4. limbs: darker, paw leathery, claws ivory, spikes bone
  albedo.push(custom('limbs', (v) => {
    const paw = v.region('paw', 0.03);
    if (paw > 0.01) v.color = lerp(v.color, lerp(pal.scaleDark, pal.hornDark, 0.5), paw * 0.8);
    const toe = v.region('toe', 0.015);
    if (toe > 0.01) v.color = lerp(v.color, lerp(pal.scaleDark, pal.hornDark, 0.7), toe * 0.85);
    const sp = v.region('spike', 0.012);
    if (sp > 0.01) v.color = lerp(v.color, lerp(pal.hornDark, pal.hornTip, smoothstep(0.0, 0.7, 1 - v.ao)), sp * 0.95);
    const cl = v.region('claw', 0.006);
    if (cl > 0.01) v.color = lerp(v.color, lerp(pal.claw, adjust(pal.claw, -0.25, 0.9), 1 - v.ao), cl);
  }));

  // 5. head: horns pale at the tips, teeth ivory, lips dark, eyes
  const head = a.head;
  albedo.push(custom('head', (v) => {
    const horn = v.region('horn', 0.012);
    if (horn > 0.01) {
      const d = Math.hypot(v.p[0] - head[0], v.p[1] - head[1], v.p[2] - head[2]) / s;
      const t = smoothstep(0.5, 1.8, d);
      const ring = 0.5 + 0.5 * Math.sin(d * 26) * 0.4;
      const c = lerp(lerp(pal.hornDark, pal.gold, 0.18), pal.hornTip, t);
      v.color = lerp(v.color, [c[0] * (0.85 + 0.2 * ring), c[1] * (0.85 + 0.2 * ring), c[2] * (0.85 + 0.2 * ring)], horn);
    }
    const fr = v.region('frill', 0.02);
    if (fr > 0.01) v.color = lerp(v.color, lerp(pal.scaleDark, pal.scaleLight, 0.3 + 0.4 * (1 - v.ao)), fr * 0.8);
    const br = v.region('brow', 0.02);
    if (br > 0.01) v.color = lerp(v.color, lerp(pal.scaleDark, pal.hornDark, 0.5), br * 0.6);
    const muz = v.region('muzzle', 0.04);
    if (muz > 0.01) v.color = lerp(v.color, lerp(pal.scale, pal.scaleLight, 0.25), muz * 0.35 * smoothstep(0.2, 0.9, v.n[1]));
    const jaw = v.region('jaw', 0.03);
    if (jaw > 0.01) v.color = lerp(v.color, lerp(pal.belly, pal.scale, 0.45), jaw * 0.6 * smoothstep(0.1, -0.5, v.n[1]));
    const beard = v.region('beard', 0.01);
    if (beard > 0.01) v.color = lerp(v.color, pal.hornTip, beard * 0.8);
    const wh = v.region('whisker', 0.01);
    if (wh > 0.01) v.color = lerp(v.color, lerp(pal.gold, pal.hornTip, 0.25), wh * 0.9);
    const tooth = v.region('tooth', 0.004);
    if (tooth > 0.01) v.color = lerp(v.color, lerp(pal.tooth, adjust(pal.tooth, -0.2, 0.9), 1 - v.ao), tooth);
    const lip = v.region('lipline', 0.008);
    if (lip > 0.01) v.color = lerp(v.color, dark, lip * 0.85);
    const mi = v.region('mouthin', 0.008);
    if (mi > 0.01) v.color = lerp(v.color, lerp(pal.mouth, dark, 0.45), mi);
    const nos = v.region('nostril', 0.006);
    if (nos > 0.01) v.color = lerp(v.color, dark, nos);
    const eye = v.region('eye', 0.0035);
    if (eye > 0.01) v.color = lerp(v.color, pal.eye, eye);
    const rim = v.region('eye', 0.02) * (1 - eye);
    if (rim > 0.01) v.color = lerp(v.color, dark, rim * 0.6);
    const pu = v.region('pupil', 0.0012);
    if (pu > 0.01) v.color = lerp(v.color, [0.01, 0.004, 0.003], pu);
  }));

  // 6. wing: bones darker/redder, leathery membrane gradient root -> rim with radiating veins and panel creases
  albedo.push(custom('wing', (v) => {
    const mem = v.region('membrane', 0.02);
    const bone = Math.max(v.region('wingbone', 0.015), v.region('finger', 0.015));
    if (mem > 0.01) {
      const mm = membranes[v.p[0] >= 0 ? 0 : 1]!;
      const q = sampleMembrane(mm, v.p);
      const rimT = smoothstep(0.35, 1.0, q.v);
      const bell = Math.sin(Math.PI * clamp01(q.u));
      let c = lerp(lerp(pal.membrane, pal.scaleDark, 0.45), pal.membraneEdge, rimT * 0.6 + bell * 0.35 * smoothstep(0.1, 0.7, q.v));
      // translucent warm centre of every panel, dark where it hugs a finger
      c = lerp(c, lerp(pal.membraneEdge, pal.heat, 0.22), bell * smoothstep(0.3, 0.95, q.v) * 0.45);
      c = lerp(c, lerp(pal.scaleDark, dark, 0.5), (1 - smoothstep(0.0, 0.13, Math.min(q.u, 1 - q.u))) * 0.7);
      // secondary veins: branching hairlines, plus a thicker radial rib at each quarter
      const wob = 0.025 * v.noise.noise(v.p[0] * 4 / s, v.p[1] * 4 / s, v.p[2] * 4 / s);
      const fu = (q.u + wob) * 4;
      const vein = 1 - smoothstep(0.0, 0.07, Math.abs(fu - Math.round(fu)));
      c = lerp(c, lerp(pal.membrane, dark, 0.8), vein * 0.6 * smoothstep(0.02, 0.3, q.v));
      const cross = 1 - smoothstep(0.0, 0.05, Math.abs(q.v * 7 + 3 * Math.sin(q.u * 9 + wob * 40) - Math.round(q.v * 7 + 3 * Math.sin(q.u * 9 + wob * 40))));
      c = lerp(c, lerp(pal.membrane, dark, 0.6), cross * 0.25 * smoothstep(0.15, 0.5, q.v) * (1 - rimT * 0.6));
      // mottled leather
      const mot = v.noise.fbm(v.p[0] * 3 / s, v.p[1] * 3 / s, v.p[2] * 3 / s, { octaves: 3 });
      c = lerp(c, mot > 0 ? pal.membraneEdge : pal.scaleDark, Math.abs(mot) * 0.5);
      // fine hide scales + ragged charred rim
      const sc = scaleCells(v, c, 0.6);
      const scorch = smoothstep(0.88, 1.0, q.v) * (0.5 + 0.5 * v.noise.noise(v.p[0] * 6 / s, v.p[1] * 6 / s, v.p[2] * 6 / s));
      v.color = lerp(v.color, lerp(lerp(c, sc, 0.6), dark, scorch * 0.55), mem);
    }
    if (bone > 0.01) {
      const fin = v.region('finger', 0.01);
      const up = smoothstep(0.0, 0.9, v.n[1]);
      const streak = 0.85 + 0.3 * (0.5 + 0.5 * v.noise.noise(v.p[0] * 13 / s, v.p[1] * 13 / s, v.p[2] * 13 / s));
      let b = lerp(pal.bone, pal.scaleDark, 0.3 + 0.3 * (1 - fin));
      b = lerp(b, lerp(pal.bone, pal.hornTip, 0.3), up * 0.22);
      v.color = lerp(v.color, lerp([b[0] * streak, b[1] * streak, b[2] * streak], pal.gold, 0.1 * fin), bone * 0.95);
    }
  }));

  // 7. molten cracks: dark charcoal rim in the albedo (the lava itself lives in the emissive map)
  albedo.push(custom('cracks', (v) => {
    const c = crack(v);
    if (c.wide > 0.01) v.color = lerp(v.color, lerp(dark, pal.ember, 0.2), clamp01(c.wide * 0.9));
  }));

  // 8. painter's grain: fine mottle + warm flecks + dark pits over every surface except teeth/claws/eyes, so no area reads as flat colour
  albedo.push(custom('grain', (v) => {
    const keep = 1 - Math.max(v.region('tooth', 0.004), v.region('claw', 0.006), v.region('eye', 0.0035), v.region('pupil', 0.0012));
    if (keep < 0.05) return;
    const g = v.noise.fbm(v.p[0] * 11 / s, v.p[1] * 11 / s, v.p[2] * 11 / s, { octaves: 3 });
    const sp = v.noise.noise(v.p[0] * 38 / s, v.p[1] * 38 / s, v.p[2] * 38 / s);
    const k = 1 + g * 0.32 * keep;
    let c: Rgb = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
    const fleck = smoothstep(0.5, 0.75, sp) * keep;
    if (fleck > 0.01) c = lerp(c, lerp(pal.scaleLight, pal.gold, 0.5), fleck * 0.45);
    const pit = smoothstep(-0.5, -0.78, sp) * keep;
    if (pit > 0.01) c = lerp(c, dark, pit * 0.4);
    v.color = c;
  }));

  // ---- emissive: pure light, black elsewhere
  const emissive: PaintLayer[] = [
    fill([0, 0, 0]),
    custom('lava', (v) => {
      const c = crack(v);
      if (c.core > 0.01) {
        const hot = lerp(pal.ember, pal.heat, smoothstep(0.55, 1.0, c.core));
        v.color = [v.color[0] + hot[0] * c.core, v.color[1] + hot[1] * c.core, v.color[2] + hot[2] * c.core];
      }
      // soft ember glow bleeding around the cracks
      const glow = c.wide * 0.18;
      if (glow > 0.01) v.color = [v.color[0] + pal.ember[0] * glow, v.color[1] + pal.ember[1] * glow, v.color[2] + pal.ember[2] * glow];
      // eyes, hot mouth, nostrils
      const eye = v.region('eye', 0.004);
      if (eye > 0.01) v.color = [v.color[0] + pal.heat[0] * eye * 0.9, v.color[1] + pal.heat[1] * eye * 0.9, v.color[2] + pal.heat[2] * eye * 0.7];
      const pu = v.region('pupil', 0.0015);
      if (pu > 0.01) v.color = [v.color[0] * (1 - pu), v.color[1] * (1 - pu), v.color[2] * (1 - pu)];
      const mi = v.region('mouthin', 0.01);
      if (mi > 0.01) {
        const h = 0.55 + 0.45 * v.noise.noise(v.p[0] * 6, v.p[1] * 6, v.p[2] * 6);
        v.color = [v.color[0] + pal.ember[0] * mi * h, v.color[1] + pal.ember[1] * mi * h, v.color[2] + pal.ember[2] * mi * h];
      }
      const nos = v.region('nostril', 0.008);
      if (nos > 0.01) v.color = [v.color[0] + pal.ember[0] * nos * 0.8, v.color[1] + pal.ember[1] * nos * 0.8, v.color[2] + pal.ember[2] * nos * 0.8];
      // faint ember veins in the wing roots
      const mem = v.region('membrane', 0.02);
      if (mem > 0.01) {
        const q = sampleMembrane(membranes[v.p[0] >= 0 ? 0 : 1]!, v.p);
        const root = (1 - smoothstep(0.1, 0.95, q.v)) * 0.55 * mem;
        const wobE = 0.025 * v.noise.noise(v.p[0] * 4 / s, v.p[1] * 4 / s, v.p[2] * 4 / s);
        const fu = (q.u + wobE) * 4;
        const vein = 1 - smoothstep(0.0, 0.05, Math.abs(fu - Math.round(fu)));
        const e = root * vein * (0.7 + 0.3 * v.noise.noise(v.p[0] * 3 / s, v.p[1] * 3 / s, v.p[2] * 3 / s));
        if (e > 0.01) v.color = [v.color[0] + pal.ember[0] * e, v.color[1] + pal.ember[1] * e, v.color[2] + pal.ember[2] * e];
      }
    }),
  ];

  const shade: PaintLayer[] = [cavity(0.32, 0.12), bakeAo(0.72, [0.45, 0.28, 0.3]), hemi(rgb('#fff1dc'), rgb('#9a6a58'), 0.5), rimTint(rgb('#ffc890'), { strength: 0.12 })];
  return { albedo, emissive, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 88 } } : {}) };
}

export type { Vec3 };
