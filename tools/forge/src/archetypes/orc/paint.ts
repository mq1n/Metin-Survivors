// Orc skin paint for `hooks.paint`: mottled hide, ivory tusks, dark claws, nostrils, inner ears, scars. Inserted right after the humanoid
// skin / eye layers so outfit pieces still paint over it.
import { clamp01, smoothstep } from '../../core/math.ts';
import { custom } from '../../core/paint/layers.ts';
import { type PaintLayer, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy, HumanoidPaint } from '../humanoid/index.ts';

export interface OrcPaintOpts {
  tusk?: string;
  claw?: string;
  /** large-scale blotchy variation of the hide (0..1) */
  mottle?: number;
  /** dark cavity creep / wrinkles (0..1) */
  wrinkle?: number;
  /** lighter belly / chest tone mixed in toward the front (hex) */
  belly?: string;
  /** darker spine / shoulders tone (hex) */
  back?: string;
  scar?: string;
}

export function orcPaint(o: OrcPaintOpts = {}): (paint: HumanoidPaint, a: Anatomy) => HumanoidPaint {
  return (paint, a) => {
    const base = rgb(a.p.skin.base), shade = rgb(a.p.skin.shade);
    const tusk = rgb(o.tusk ?? '#e6dbbd'), tuskDark = rgb('#a89870');
    const claw = rgb(o.claw ?? '#2b2218');
    const belly = o.belly ? rgb(o.belly) : null, back = o.back ? rgb(o.back) : null;
    const mot = o.mottle ?? 0.5, wr = o.wrinkle ?? 0.6;
    const layers: PaintLayer[] = [
      custom('orcSkin', (v) => {
        const m = v.region('skin', 0.004);
        if (m <= 0) return;
        const n1 = v.noise.fbm(v.p[0] * 5, v.p[1] * 5, v.p[2] * 5, { octaves: 3 });
        const n2 = v.noise.fbm(v.p[0] * 22 + 9, v.p[1] * 22, v.p[2] * 22, { octaves: 3 });
        let c = v.color;
        c = mixRgb(c, shade, clamp01(0.5 + n1 * 0.9) * 0.45 * mot * m);
        // wrinkles and pores darken in the cavities, knuckles / brow ridges lighten
        const cav = v.cavity;
        c = mixRgb(c, shade, clamp01(-cav * 1.4) * 0.55 * wr * m);
        c = mixRgb(c, mixRgb(base, [1, 1, 1], 0.18), clamp01(cav * 1.2) * 0.3 * m);
        const k = 1 + 0.12 * n2 * m;
        c = [c[0] * k, c[1] * k, c[2] * k];
        if (belly) c = mixRgb(c, belly, smoothstep(0.1, 0.9, v.n[2]) * 0.35 * smoothstep(1.55, 0.95, v.p[1]) * m);
        if (back) c = mixRgb(c, back, smoothstep(0.1, 0.9, -v.n[2]) * 0.4 * m);
        v.color = c;
      }),
      custom('orcDetail', (v) => {
        const tk = v.region('tusk', 0.0025);
        if (tk > 0) v.color = mixRgb(v.color, mixRgb(tusk, tuskDark, smoothstep(0.0, 0.8, v.noise.fbm(v.p[0] * 80, v.p[1] * 30, v.p[2] * 80, { octaves: 2 }) + 0.3) * 0.5), tk);
        const cl = v.region('claw', 0.002);
        if (cl > 0) v.color = mixRgb(v.color, claw, cl * 0.95);
        const ns = v.region('nostril', 0.0035);
        if (ns > 0) v.color = mixRgb(v.color, rgb('#150c0c'), ns);
        const ei = v.region('ear_inner', 0.004);
        if (ei > 0) v.color = mixRgb(v.color, mixRgb(shade, rgb('#a05a4a'), 0.55), ei * 0.7);
        const jw = v.region('jowl', 0.012);
        if (jw > 0) v.color = mixRgb(v.color, shade, jw * 0.18);
        if (o.scar) {
          const sc = v.region('ink', 0.003);
          if (sc > 0) v.color = mixRgb(v.color, rgb(o.scar), sc * 0.85);
        }
      }),
    ];
    const at = paint.albedo.findIndex((l) => l.name === 'eyes');
    const albedo = at >= 0 ? [...paint.albedo.slice(0, at + 1), ...layers, ...paint.albedo.slice(at + 1)] : [...paint.albedo, ...layers];
    return { ...paint, albedo };
  };
}
