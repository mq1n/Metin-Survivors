// Paint stacks for the frost giants (procedural albedo / shade / emissive). The Painter stage later replaces the albedo
// texture and follows these colours as its guide, so the material hierarchy (value + hue per zone) lives here; the
// COLOR_0 shading (cool shadow tint) and the emissive map positions come from the same stacks.
import { clamp01, smoothstep } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, furClumps, hemi, rimTint, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, type Rgb, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { HumanoidPaint } from '../humanoid/index.ts';

/** faceted ice: bright on upward faces and edges, deep blue in the lows, frosted tops */
function iceLook(ice: Rgb, deep: Rgb, frost: Rgb): PaintLayer {
  return custom('ice', (v) => {
    const m = v.region('ice', 0.004);
    if (m <= 0) return;
    const up = v.n[1] * 0.5 + 0.5;
    const streak = v.noise.fbm(v.p[0] * 16, v.p[1] * 16, v.p[2] * 16, { octaves: 3 });
    const t = clamp01(0.3 + 0.5 * up + 0.35 * Math.max(0, v.cavity) - 0.5 * Math.max(0, -v.cavity) + streak * 0.25);
    const c = mixRgb(deep, ice, smoothstep(0.1, 0.8, t));
    v.color = mixRgb(v.color, mixRgb(c, frost, smoothstep(0.7, 1, t) * 0.7), m);
  });
}

export interface YetiPalette {
  fur: string;
  furShade: string;
  furWarm: string;
  /** forearm / shin fur: darker steel blue so the long limbs read against the white body */
  furDark: string;
  /** bare skin: face, fists, foot pads */
  bare: string;
  bareDark: string;
  /** lighter muzzle / chin / knuckle accent */
  bareLight: string;
  mouth: string;
  tusk: string;
  eye: string;
  ice: string;
  iceDeep: string;
}

export const YETI_PALETTE: YetiPalette = {
  fur: '#f3f6fa',
  furShade: '#6c7cb0',
  furWarm: '#d6d2cc',
  furDark: '#8896b8',
  bare: '#4d4f9a',
  bareDark: '#23264f',
  bareLight: '#8a84c6',
  mouth: '#4a1630',
  tusk: '#f4ecd4',
  eye: '#b8f6ff',
  ice: '#c4e8ff',
  iceDeep: '#4f8fd6',
};

/** yeti: matted white fur with blue-violet shadows, an indigo face / fists / foot pads with light muzzle, glowing cyan eyes, ivory teeth, ice horns + crystals */
export function yetiPaint(pal: YetiPalette = YETI_PALETTE): (p: HumanoidPaint) => HumanoidPaint {
  const fur = rgb(pal.fur), shade = rgb(pal.furShade), warm = rgb(pal.furWarm), dark = rgb(pal.furDark);
  const bare = rgb(pal.bare), bareDark = rgb(pal.bareDark), bareLight = rgb(pal.bareLight), mouth = rgb(pal.mouth), tusk = rgb(pal.tusk), eye = rgb(pal.eye);
  return () => {
    const albedo: PaintLayer[] = [
      fill(fur),
      // flow-aligned strands: down the limbs, back along the spine (an average downward-backward flow reads fine at this scale)
      strands({ flow: () => [0, -1, -0.35], freq: 85, stretch: 7, amount: 0.2, octaves: 2 }),
      strands({ flow: () => [0, -1, -0.35], freq: 260, stretch: 10, amount: 0.3, octaves: 2, tint: adjust(warm, 0.05, 0.8) }),
      furClumps({ freq: 26, amount: 0.12, stretch: [1, 0.8, 1] }),
      custom('furTone', (v) => {
        // yellowed matted patches + cool blue-violet in the lows, dirtier toward the ground
        const n = v.noise.fbm(v.p[0] * 5, v.p[1] * 5, v.p[2] * 5, { octaves: 3 });
        v.color = mixRgb(v.color, warm, clamp01(0.5 + n) * 0.26);
        const low = 1 - smoothstep(0.15, 0.85, v.ao);
        v.color = mixRgb(v.color, shade, clamp01(low * 0.7 + Math.max(0, -v.cavity) * 0.4));
        v.color = mixRgb(v.color, shade, (1 - smoothstep(0.2, 0.9, v.p[1])) * 0.35);
      }),
      custom('furDark', (v) => {
        const m = v.region('furdark', 0.01);
        if (m > 0) v.color = mixRgb(v.color, mixRgb(dark, shade, clamp01(0.35 + Math.max(0, -v.cavity) * 0.6)), m * 0.8);
      }),
      custom('bare', (v) => {
        const m = v.region('bare', 0.012);
        if (m <= 0) return;
        const n = v.noise.fbm(v.p[0] * 22, v.p[1] * 22, v.p[2] * 22, { octaves: 3 });
        let skin = mixRgb(bare, bareDark, clamp01(0.25 + 0.4 * n + Math.max(0, -v.cavity) * 0.7));
        // lighter muzzle / chin / knuckle accents keep the face and fists readable against the fur
        const lit = Math.max(v.region('muzzle', 0.01), v.region('chin', 0.01) * 0.7, v.region('knuckle', 0.008) * 0.7, v.region('nose', 0.006) * 0.5);
        skin = mixRgb(skin, bareLight, clamp01(lit) * 0.75);
        v.color = mixRgb(v.color, skin, m);
        const dark = Math.max(v.region('lip', 0.005) * 0.7, v.region('nostril', 0.004), v.region('lid', 0.004) * 0.85);
        if (dark > 0) v.color = mixRgb(v.color, bareDark, clamp01(dark) * 0.9);
        const inside = v.region('lipline', 0.004);
        if (inside > 0) v.color = mixRgb(v.color, mouth, clamp01(inside) * 0.95);
        const brow = v.region('brow', 0.012);
        if (brow > 0) v.color = mixRgb(v.color, mixRgb(bareDark, [0.02, 0.02, 0.06], 0.5), brow * 0.75);
      }),
      iceLook(rgb(pal.ice), rgb(pal.iceDeep), rgb('#ffffff')),
      custom('teeth', (v) => {
        const m = v.region('tusk', 0.003);
        if (m > 0) v.color = mixRgb(v.color, tusk, m);
        const e = v.region('eye', 0.002);
        if (e > 0) v.color = mixRgb(v.color, mixRgb(eye, [1, 1, 1], 0.45), e);
      }),
    ];
    const shadeStack: PaintLayer[] = [
      cavity(0.45, 0.1),
      bakeAo(0.68, [0.46, 0.55, 0.78], 1.2),
      hemi(rgb('#ffffff'), rgb('#9aa8c8'), 0.6),
      rimTint(rgb('#d8ecff'), { strength: 0.12 }),
    ];
    const emissive: PaintLayer[] = [
      custom('glow', (v) => {
        const m = v.region('glow', 0.0025);
        if (m > 0) v.color = [eye[0] * m, eye[1] * m, eye[2] * m];
      }),
    ];
    return { albedo, shade: shadeStack, emissive };
  };
}

export interface FrostyPalette {
  ice: string;
  iceDeep: string;
  iceFrost: string;
  core: string;
  wood: string;
  woodDark: string;
  /** boot fur */
  fur: string;
  furShade: string;
  /** loincloth */
  cloth: string;
  clothDark: string;
  belt: string;
  gold: string;
  skinFrost: string;
}

export const FROSTY_PALETTE: FrostyPalette = {
  ice: '#eaf9ff',
  iceDeep: '#4aa4e0',
  iceFrost: '#ffffff',
  core: '#8fe9ff',
  wood: '#8a6845',
  woodDark: '#43301f',
  fur: '#9a9088',
  furShade: '#463e3a',
  cloth: '#8a3d34',
  clothDark: '#3d1a18',
  belt: '#2a211d',
  gold: '#d8b04a',
  skinFrost: '#9fbad8',
};

/** frost giant: dark teal skin, near-white faceted ice, rust-red loincloth with a gold-buckled leather belt, grey fur boots, brown frosted club, cyan glow eyes + cores */
export function frostyPaint(pal: FrostyPalette = FROSTY_PALETTE): (p: HumanoidPaint) => HumanoidPaint {
  const core = rgb(pal.core), iceFrost = rgb(pal.iceFrost);
  const wood = rgb(pal.wood), woodDark = rgb(pal.woodDark), fur = rgb(pal.fur), furShade = rgb(pal.furShade);
  const cloth = rgb(pal.cloth), clothDark = rgb(pal.clothDark), belt = rgb(pal.belt), gold = rgb(pal.gold), skinFrost = rgb(pal.skinFrost);
  return (paint) => {
    const albedo: PaintLayer[] = [
      ...paint.albedo,
      // rime on the skin: patchy frost on shoulders / upward-facing surfaces
      custom('skinFrost', (v) => {
        const n = v.noise.fbm(v.p[0] * 9, v.p[1] * 9, v.p[2] * 9, { octaves: 3 });
        const up = clamp01(v.n[1] * 0.8 + 0.1);
        v.color = mixRgb(v.color, skinFrost, clamp01((n + 0.2) * 1.6) * up * 0.22);
      }),
      custom('belt', (v) => {
        const m = v.region('belt', 0.006);
        if (m <= 0) return;
        const g = v.noise.fbm(v.p[0] * 60, v.p[1] * 60, v.p[2] * 60, { octaves: 2 });
        v.color = mixRgb(v.color, mixRgb(belt, [0.03, 0.025, 0.02], clamp01(0.4 + g)), m);
      }),
      custom('trim', (v) => {
        const m = v.region('trim', 0.004);
        if (m <= 0) return;
        const wear = clamp01(0.5 + 0.8 * Math.max(0, v.cavity) - 0.6 * Math.max(0, -v.cavity));
        v.color = mixRgb(v.color, mixRgb(mixRgb(gold, [0.25, 0.16, 0.05], 0.55), gold, wear), m);
      }),
      // loincloth: heavy rust-red cloth, frayed darker toward the hem
      custom('cloth', (v) => {
        const m = v.region('cloth', 0.006);
        if (m <= 0) return;
        const n = v.noise.fbm(v.p[0] * 40, v.p[1] * 12, v.p[2] * 40, { octaves: 3 });
        const c = mixRgb(cloth, clothDark, clamp01(0.3 + 0.5 * n + (1 - v.ao) * 0.6));
        v.color = mixRgb(v.color, c, m);
      }),
      strands({ flow: () => [0, -1, 0], freq: 90, stretch: 7, amount: 0.18, octaves: 2, mask: (v) => v.region('fur', 0.006) }),
      custom('fur', (v) => {
        const m = v.region('fur', 0.006);
        if (m <= 0) return;
        const n = v.noise.fbm(v.p[0] * 14, v.p[1] * 14, v.p[2] * 14, { octaves: 2 });
        let c = mixRgb(fur, furShade, clamp01(0.25 + 0.4 * n + (1 - v.ao) * 0.8));
        c = mixRgb(c, iceFrost, smoothstep(0.2, 0.9, v.n[1]) * 0.35);
        v.color = mixRgb(v.color, c, m);
      }),
      custom('wood', (v) => {
        const m = v.region('wood', 0.006);
        if (m <= 0) return;
        const grain = v.noise.fbm(v.p[0] * 70, v.p[1] * 70, v.p[2] * 9, { octaves: 3 });
        let c = mixRgb(wood, woodDark, clamp01(0.3 + grain * 0.7 + Math.max(0, -v.cavity) * 0.6));
        // frost caught on the upward faces
        const rime = smoothstep(0.2, 0.7, v.n[1]) * clamp01(0.5 + v.noise.fbm(v.p[0] * 30, v.p[1] * 30, v.p[2] * 30, { octaves: 2 }));
        c = mixRgb(c, iceFrost, rime * 0.6);
        v.color = mixRgb(v.color, c, m);
      }),
      iceLook(rgb(pal.ice), rgb(pal.iceDeep), iceFrost),
      custom('core', (v) => {
        const m = v.region('core', 0.003);
        if (m > 0) v.color = mixRgb(v.color, mixRgb(core, [1, 1, 1], 0.35), m);
      }),
      // eyes: glowing cyan with a dark pupil
      custom('frostEyes', (v) => {
        const e = v.region('eye', 0.0015);
        if (e > 0) v.color = mixRgb(v.color, mixRgb(core, [1, 1, 1], 0.5), e);
        const iris = v.region('iris', 0.0018);
        if (iris > 0) v.color = mixRgb(v.color, mixRgb(core, [1, 1, 1], 0.15), iris);
      }),
    ];
    const shadeStack: PaintLayer[] = [
      cavity(0.45, 0.12),
      bakeAo(0.66, [0.48, 0.58, 0.8], 1.2),
      hemi(rgb('#ffffff'), rgb('#9fb0cc'), 0.55),
      rimTint(rgb('#d6efff'), { strength: 0.12 }),
    ];
    const emissive: PaintLayer[] = [
      custom('glow', (v) => {
        const c = Math.max(v.region('core', 0.003), v.region('iris', 0.0022) * 0.95, v.region('eye', 0.0015) * 0.7);
        if (c > 0) v.color = [core[0] * c, core[1] * c, core[2] * c];
      }),
    ];
    return { albedo, shade: shadeStack, emissive };
  };
}
