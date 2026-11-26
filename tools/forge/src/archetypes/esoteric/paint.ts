// Skin paint for the esoteric heads (`hooks.paint`): weathered skin, sunken-cheek shadow, teeth, beard, mouth interior and ritual marks.
// Inserted right after the humanoid skin / eye layers so outfit pieces still paint over it.
import { clamp01 } from '../../core/math.ts';
import { custom } from '../../core/paint/layers.ts';
import { type PaintLayer, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy, HumanoidPaint } from '../humanoid/index.ts';

export interface MonkPaintOpts {
  tooth?: string;
  beard?: string;
  /** large-scale blotchy variation of the skin (0..1) */
  mottle?: number;
  /** darkening in the hollows and creases (0..1) */
  hollow?: number;
}

export function monkPaint(o: MonkPaintOpts = {}): (paint: HumanoidPaint, a: Anatomy) => HumanoidPaint {
  return (paint, a) => {
    const base = rgb(a.p.skin.base), shade = rgb(a.p.skin.shade);
    const tooth = rgb(o.tooth ?? '#e8dcc0'), beard = rgb(o.beard ?? '#2a2018');
    const mot = o.mottle ?? 0.45, hol = o.hollow ?? 0.7;
    const layers: PaintLayer[] = [
      custom('monkSkin', (v) => {
        const m = v.region('skin', 0.004);
        if (m <= 0) return;
        const n1 = v.noise.fbm(v.p[0] * 6 + 3, v.p[1] * 6, v.p[2] * 6, { octaves: 3 });
        const n2 = v.noise.fbm(v.p[0] * 26 + 9, v.p[1] * 26, v.p[2] * 26, { octaves: 2 });
        let c = v.color;
        c = mixRgb(c, shade, clamp01(0.45 + n1 * 0.9) * 0.4 * mot * m);
        c = mixRgb(c, shade, clamp01(-v.cavity * 1.3) * 0.55 * hol * m);
        c = mixRgb(c, mixRgb(base, [1, 1, 1], 0.14), clamp01(v.cavity * 1.1) * 0.25 * m);
        const k = 1 + 0.1 * n2 * m;
        v.color = [c[0] * k, c[1] * k, c[2] * k];
      }),
      custom('monkDetail', (v) => {
        const hl = v.region('hollow', 0.012);
        if (hl > 0) v.color = mixRgb(v.color, shade, hl * 0.4);
        const tt = v.region('tooth', 0.0025);
        if (tt > 0) v.color = mixRgb(v.color, tooth, tt * 0.95);
        const bd = v.region('beard', 0.004);
        if (bd > 0) v.color = mixRgb(v.color, beard, bd * 0.95);
        const mi = v.region('mouthin', 0.004);
        if (mi > 0) v.color = mixRgb(v.color, rgb('#2a0e0c'), mi * 0.9);
      }),
    ];
    const at = paint.albedo.findIndex((l) => l.name === 'eyes');
    const albedo = at >= 0 ? [...paint.albedo.slice(0, at + 1), ...layers, ...paint.albedo.slice(at + 1)] : [...paint.albedo, ...layers];
    return { ...paint, albedo };
  };
}
