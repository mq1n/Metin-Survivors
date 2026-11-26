import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { METIN_CAP_RAMP_SHARE, METIN_TYPE_ALBEDO_CAP, METIN_TYPE_BODY, METIN_TYPE_SAT_CAP, metinBodyTint, metinCappedEmissive, metinDamageRamp, metinEmissiveCap, metinShiftTexel, metinTypeShift, parseEmissiveCap, runeTint, RUNE_TINT } from './metin';

describe('E3 metin damage ramp', () => {
  it('is 1 at full health and 1.9 at zero, linear in between', () => {
    expect(metinDamageRamp(1)).toBe(1);
    expect(metinDamageRamp(0)).toBeCloseTo(1.9, 6);
    expect(metinDamageRamp(0.5)).toBeCloseTo(1.45, 6);
  });
  it('clamps hp outside 0..1', () => {
    expect(metinDamageRamp(2)).toBe(1);
    expect(metinDamageRamp(-1)).toBeCloseTo(1.9, 6);
  });
});

describe('M4 rune tint of a glyph:false stone', () => {
  it('accepts a hex string, keeps the full value of the brightest channel and tints 30 % toward the rune', () => {
    const c = runeTint('#5a8cff');
    const r = new Color('#5a8cff');
    expect(RUNE_TINT).toBeCloseTo(0.3, 6);
    expect(c.b).toBeCloseTo(1, 5);
    expect(c.r).toBeCloseTo(1 - RUNE_TINT * (1 - r.r / r.b), 5);
    expect(c.r).toBeLessThan(c.b);
  });
  it('different rune colours give different tints, a grey rune stays near white', () => {
    expect(runeTint('#ff4040').r).toBeGreaterThan(runeTint('#ff4040').g);
    expect(runeTint('#ffffff').g).toBeCloseTo(1, 5);
  });
});

describe('r5 body tint of the shared small stone (extras.bodyTint)', () => {
  const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const runes = ['#5a8cff', '#ff6a3a', '#e84a4a', '#ffcf4a', '#9a7aff', '#6a4ac8', '#3cd08a', '#7ae0ff', '#8a8ab0', '#8aa07a', '#ff3a5a', '#b8f0c8', '#ff3a1a'];
  it('keeps every type near a fixed luminance (blue / violet do not darken the stone), no channel above 2.2', () => {
    for (const r of runes) {
      const c = metinBodyTint(r, 0.6);
      expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(2.2 + 1e-9);
      expect(lum(c)).toBeGreaterThan(0.85);
      expect(lum(c)).toBeLessThan(1.2);
    }
  });
  it('gives the pale runes (death, toughness, shadow) a visible hue', () => {
    for (const r of ['#b8f0c8', '#8aa07a', '#8a8ab0']) {
      const c = metinBodyTint(r, 0.6), mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
      expect((mx - mn) / mx).toBeGreaterThan(0.25);
    }
  });
  it('the 13 types are pairwise distinct', () => {
    const cs = runes.map((r) => metinBodyTint(r, 0.6));
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i]!, b = cs[j]!;
      expect(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)).toBeGreaterThan(0.02);
    }
  });
  it('strength 0 is white, and a white rune stays neutral and lighter', () => {
    const z = metinBodyTint('#5a8cff', 0);
    expect(z.r).toBeCloseTo(1, 6); expect(z.g).toBeCloseTo(1, 6); expect(z.b).toBeCloseTo(1, 6);
    const w = metinBodyTint('#ffffff', 0.6);
    expect(w.r).toBeCloseTo(w.g, 6); expect(w.g).toBeCloseTo(w.b, 6);
    expect(w.r).toBeGreaterThan(1);
  });
});

describe('r5 emissive soft cap (extras.emissiveCap)', () => {
  it('is the identity up to the knee, eases toward the cap, never above it, and is monotonic', () => {
    expect(metinEmissiveCap(1.2, 1.6, 2.6)).toBe(1.2);
    expect(metinEmissiveCap(5.7, 1.6, 2.6)).toBeLessThan(2.6);
    expect(metinEmissiveCap(5.7, 1.6, 2.6)).toBeGreaterThan(2.5);
    let prev = 0;
    for (let e = 0; e < 8; e += 0.05) { const v = metinEmissiveCap(e, 1.6, 2.6); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
  });
});

describe('r5 ship: capped base glow + damage ramp on top (extras.emissiveCap)', () => {
  it('keeps the awakened heartbeat and the low-HP ramp alive under the cap', () => {
    const [knee, cap] = [1.4, 2.2];
    const lo = (r: number): number => metinCappedEmissive(1.7, r, knee, cap), hi = (r: number): number => metinCappedEmissive(3.0, r, knee, cap);
    // full HP: the peak stays under the ceiling, the beat stays visible
    expect(hi(1)).toBeLessThan(cap);
    expect(hi(1) - lo(1)).toBeGreaterThan(0.35);
    // 0 HP: brighter than full HP by the ramp share, and the beat is not flattened (the old cap of base x ramp left 0.19)
    const r0 = metinDamageRamp(0);
    expect(hi(r0)).toBeCloseTo(hi(1) * (1 + (r0 - 1) * METIN_CAP_RAMP_SHARE), 9);
    expect(hi(r0) - lo(r0)).toBeGreaterThan(hi(1) - lo(1));
    expect(hi(r0)).toBeLessThan(cap * 1.35);
  });
  it('is the plain cap when there is no ramp (fall / drop, forge stones)', () => {
    for (const e of [0.4, 1.2, 2.0, 3.2]) expect(metinCappedEmissive(e, 1, 1.6, 2.6)).toBe(metinEmissiveCap(e, 1.6, 2.6));
  });
  it('parses extras.emissiveCap defensively: malformed values mean no cap, never NaN', () => {
    expect(parseEmissiveCap([1.6, 2.6])).toEqual([1.6, 2.6]);
    expect(parseEmissiveCap(['1.4', '2.2'])).toEqual([1.4, 2.2]);
    for (const bad of [undefined, null, 2, [1.6], [1.6, 'x'], [2.6, 1.6], [0, 1], [Number.NaN, 2], [1, Infinity]]) expect(parseEmissiveCap(bad)).toBeNull();
  });
});

describe('r7 per-type body of the small stone (extras.bodyPalette): luminance-preserving hue shift', () => {
  // CIEDE2000 (Sharma 2005) on linear sRGB -> Lab (D65)
  const lab = (c: readonly number[]): [number, number, number] => {
    const X = (0.4124 * c[0]! + 0.3576 * c[1]! + 0.1805 * c[2]!) / 0.95047, Y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!, Z = (0.0193 * c[0]! + 0.1192 * c[1]! + 0.9505 * c[2]!) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const de00 = (p: [number, number, number], q: [number, number, number]): number => {
    const [L1, a1, b1] = p, [L2, a2, b2] = q, rad = Math.PI / 180;
    const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
    const h1 = (Math.atan2(b1, a1p) / rad + 360) % 360, h2 = (Math.atan2(b2, a2p) / rad + 360) % 360;
    let dh = h2 - h1;
    if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
    const Lb = (L1 + L2) / 2, Cbp = (C1 + C2) / 2;
    const hb = C1 * C2 === 0 ? h1 + h2 : Math.abs(h1 - h2) > 180 ? (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2) : (h1 + h2) / 2;
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
    const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)), Rt = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * Rc;
    const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
  };
  const runes = ['#5a8cff', '#ff6a3a', '#e84a4a', '#ffcf4a', '#9a7aff', '#6a4ac8', '#3cd08a', '#7ae0ff', '#8a8ab0', '#8aa07a', '#ff3a5a', '#b8f0c8', '#ff3a1a'];
  // a grey reference stone: 4,000 texels, log-normal luminance about 0.13 (mean ~0.15, the built granite skin), plus a few near-white and near-black texels
  const texels: [number, number, number][] = [];
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) {
    const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    const l = Math.min(1, Math.exp(Math.log(0.13) + 0.45 * g));
    texels.push([l, l * 1.02, l * 0.97]);
  }
  texels.push([1, 1, 1], [0.95, 0.9, 0.85], [0, 0, 0], [0.004, 0.004, 0.004]);
  const ref = texels.reduce((a, t) => a + 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2], 0) / texels.length;
  const meanOf = (r: string): number[] => {
    const s = metinTypeShift(r, ref)!, acc = [0, 0, 0];
    for (const t of texels) { const c = metinShiftTexel(t, s); for (let k = 0; k < 3; k++) acc[k]! += c[k]! / texels.length; }
    return acc;
  };
  it('has a shift for each of the 13 small runes, null for an unknown rune or a bad reference', () => {
    for (const r of runes) expect(metinTypeShift(r, ref)).not.toBeNull();
    expect(Object.keys(METIN_TYPE_BODY)).toHaveLength(13);
    expect(metinTypeShift('#123456', ref)).toBeNull();
    expect(metinTypeShift('#5a8cff', 0)).toBeNull();
    expect(metinTypeShift('#5a8cff', Number.NaN)).toBeNull();
  });
  it('never puts a texel above the albedo cap (the r6 death type put 13.9 % above 1.0), for any input texel', () => {
    for (const r of runes) {
      const s = metinTypeShift(r, ref)!;
      for (const t of texels) expect(Math.max(...metinShiftTexel(t, s))).toBeLessThanOrEqual(METIN_TYPE_ALBEDO_CAP + 1e-9);
      for (let v = 0; v <= 1.0001; v += 0.05) expect(Math.max(...metinShiftTexel([v, v, v], s))).toBeLessThanOrEqual(METIN_TYPE_ALBEDO_CAP + 1e-9);
    }
  });
  it('preserves each texel luminance up to the one per-type value factor (texture detail kept on every type), below the cap', () => {
    for (const r of runes) {
      const s = metinTypeShift(r, ref)!;
      for (const l of [0.02, 0.05, 0.1, 0.17, 0.25]) {
        const c = metinShiftTexel([l, l, l], s), out = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        if (Math.max(...c) < METIN_TYPE_ALBEDO_CAP - 1e-6) expect(out).toBeCloseTo(l * s.val, 6);
      }
    }
  });
  it('caps the saturation of every type (no single-hue plastic: every channel keeps >= 1 - cap of the brightest)', () => {
    for (const r of runes) {
      const ch = metinTypeShift(r, ref)!.chroma, mx = Math.max(...ch);
      expect((mx - Math.min(...ch)) / mx).toBeLessThanOrEqual(METIN_TYPE_SAT_CAP + 1e-6);
    }
  });
  it('any two types differ by CIEDE2000 >= 10 on the reference stone (the 4 reds and 2 violets included); none is a coal lump or a snowball', () => {
    const labs = runes.map((r) => lab(meanOf(r)));
    let worst = Infinity;
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) worst = Math.min(worst, de00(labs[i]!, labs[j]!));
    expect(worst).toBeGreaterThanOrEqual(10);
    for (const l of labs) { expect(l[0]).toBeGreaterThanOrEqual(25); expect(l[0]).toBeLessThanOrEqual(75); }
  });
});
