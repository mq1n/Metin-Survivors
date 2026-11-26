// Curve evaluation and LUT baking (pure: no three.js, runs in tests).
import { artOk } from './artScope';
import { ROLES } from './roles';
import { LUT_SAMPLES } from './shaders';
import type { ColorCurve, Curve, ElementSpec, ParticleSpec, SurfaceSpec, TexSrc, TrailSpec } from './types';

/** a texture source is usable: a known procedural role, or an art reference (`{ art: id }`, fallback role checked) */
export function texOk(t: TexSrc | undefined): boolean {
  if (typeof t === 'string') return ROLES[t] !== undefined;
  return t !== null && typeof t === 'object' && artOk(t.art);
}



export function withDefaults(el: ElementSpec): ElementSpec {
  let tex: TexSrc = texOk(el.tex) ? el.tex : 'glow';
  if (typeof tex !== 'string' && tex.fallback !== undefined && ROLES[tex.fallback] === undefined) tex = { ...tex, fallback: 'glow' };
  const color = el.color !== undefined && el.color.length >= 3 ? el.color : [0, 0xffffff, 1];
  const blend = el.blend ?? 'add';
  if (el.kind === 'surface') return { ...el, tex, color, blend, life: el.life > 0 ? el.life : 0.5 };
  if (el.kind === 'trail') {
    return { ...el, tex, color, blend, attach: el.attach ?? 'weapon', life: el.life > 0 ? el.life : 0.2, width: el.width > 0 ? el.width : 0.3 };
  }
  return {
    ...el,
    tex,
    color,
    blend,
    cycle: el.cycle > 0 ? el.cycle : 1,
    max: el.max >= 1 ? el.max : 1,
    rate: el.rate ?? [0, 0],
    life: el.life ?? [0, 0.5],
    half: el.half ?? [0, 0.5],
    scale: el.scale ?? [0, 1],
    billboard: el.billboard ?? 'screen',
  };
}

/** piecewise-linear evaluation of a flat [t, v, …] curve, clamped outside the keys */
export function evalCurve(c: Curve | undefined, t: number, dflt = 0): number {
  if (c === undefined || c.length < 2) return dflt;
  const n = c.length >> 1;
  if (n === 1 || t <= (c[0] as number)) return c[1] as number;
  for (let i = 1; i < n; i++) {
    const t1 = c[i * 2] as number;
    if (t <= t1) {
      const t0 = c[i * 2 - 2] as number;
      const v0 = c[i * 2 - 1] as number;
      const v1 = c[i * 2 + 1] as number;
      return t1 > t0 ? v0 + (v1 - v0) * ((t - t0) / (t1 - t0)) : v1;
    }
  }
  return c[n * 2 - 1] as number;
}

/** colour curve → [r, g, b, a] (sRGB 0..1) written into out */
export function evalColor(c: ColorCurve | undefined, t: number, out: Float32Array | number[], o = 0): void {
  const n = c === undefined ? 0 : Math.floor(c.length / 3);
  if (c === undefined || n === 0) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 1;
    return;
  }
  let i1 = 0;
  while (i1 < n && t > (c[i1 * 3] as number)) i1++;
  const i0 = i1 === 0 ? 0 : i1 - 1;
  if (i1 >= n) i1 = n - 1;
  const t0 = c[i0 * 3] as number;
  const t1 = c[i1 * 3] as number;
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
  const a = c[i0 * 3 + 1] as number;
  const b = c[i1 * 3 + 1] as number;
  out[o] = (((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k) / 255;
  out[o + 1] = (((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k) / 255;
  out[o + 2] = ((a & 255) * (1 - k) + (b & 255) * k) / 255;
  out[o + 3] = (c[i0 * 3 + 2] as number) * (1 - k) + (c[i1 * 3 + 2] as number) * k;
}

/** max of a curve's values (sizes / budgets) */
export function curveMax(c: Curve | undefined, dflt = 0): number {
  if (c === undefined || c.length < 2) return dflt;
  let m = -Infinity;
  for (let i = 1; i < c.length; i += 2) m = Math.max(m, c[i] as number);
  return m;
}

/** last key time of a curve (0 when constant) */
export function curveEnd(c: Curve | undefined): number {
  return c === undefined || c.length < 2 ? 0 : (c[c.length - 2] as number);
}

const S = LUT_SAMPLES;

export const PARTICLE_ROWS = 3;
export const SURFACE_ROWS = 4;
export const TRAIL_ROWS = 2;

/** curve LUT rows one compiled element (one grade variant) takes */
export function elementRows(el: ElementSpec): number {
  return el.kind === 'particle' ? PARTICLE_ROWS : el.kind === 'surface' ? SURFACE_ROWS : TRAIL_ROWS;
}









export function bakeParticle(el: ParticleSpec, out: Float32Array, o: number): void {
  const L = Math.max(1e-3, evalCurve(el.life, 0, 0.5));
  const sc = el.scale;
  const sx = (sc === undefined || typeof sc[0] === 'number' ? sc : sc[0]) as Curve | undefined;
  const sy = (sc === undefined || typeof sc[0] === 'number' ? sc : sc[1]) as Curve | undefined;
  const col = new Float32Array(4);
  // integrate at 8 sub-steps per sample
  const sub = 8;
  const dt = L / ((S - 1) * sub);
  let v = 1;
  let gv = 0;
  let x = 0;
  let gx = 0;
  for (let i = 0; i < S; i++) {
    const u = i / (S - 1);
    if (i > 0) {
      for (let k = 0; k < sub; k++) {
        const uu = (i - 1 + (k + 0.5) / sub) / (S - 1);
        const r = el.air ? evalCurve(el.air, uu) : 0;
        const damp = r <= 0 ? 1 : r >= 1 ? 0 : Math.pow(1 - r, 60 * dt);
        v *= damp;
        gv = gv * damp - (el.gravity ? evalCurve(el.gravity, uu) : 0) * dt;
        x += v * dt;
        gx += gv * dt;
      }
    }
    const r0 = o + i * 4;
    out[r0] = evalCurve(sx, u, 1);
    out[r0 + 1] = evalCurve(sy, u, 1);
    out[r0 + 2] = x / L;
    out[r0 + 3] = v;
    evalColor(el.color, u, col);
    const r1 = o + S * 4 + i * 4;
    out[r1] = col[0] as number;
    out[r1 + 1] = col[1] as number;
    out[r1 + 2] = col[2] as number;
    out[r1 + 3] = col[3] as number;
    const r2 = o + S * 8 + i * 4;
    out[r2] = gx / (L * L);
    out[r2 + 1] = gv / L;
    out[r2 + 2] = 0;
    out[r2 + 3] = 0;
  }
}

/**
 * Surface rows (u = element life fraction):
 *  row 0: scale x, y, z, alpha
 *  row 1: r, g, b, 0
 *  row 2: sweep head, tail, uv offset u, v
 *  row 3: move x, y, z (m), spin (rad)
 */
export function bakeSurface(el: SurfaceSpec, out: Float32Array, o: number): void {
  const col = new Float32Array(4);
  const s = el.scale;
  const uni = s === undefined || typeof s[0] === 'number';
  for (let i = 0; i < S; i++) {
    const u = i / (S - 1);
    const r0 = o + i * 4;
    if (uni) {
      const k = evalCurve(s as Curve | undefined, u, 1);
      out[r0] = out[r0 + 1] = out[r0 + 2] = k;
    } else {
      const v = s as readonly [Curve, Curve, Curve];
      out[r0] = evalCurve(v[0], u, 1);
      out[r0 + 1] = evalCurve(v[1], u, 1);
      out[r0 + 2] = evalCurve(v[2], u, 1);
    }
    evalColor(el.color, u, col);
    out[r0 + 3] = col[3] as number;
    const r1 = o + S * 4 + i * 4;
    out[r1] = col[0] as number;
    out[r1 + 1] = col[1] as number;
    out[r1 + 2] = col[2] as number;
    out[r1 + 3] = 0;
    const r2 = o + S * 8 + i * 4;
    out[r2] = el.sweep ? evalCurve(el.sweep[0], u, 1) : 1;
    out[r2 + 1] = el.sweep ? evalCurve(el.sweep[1], u, 0) : 0;
    out[r2 + 2] = el.uv ? evalCurve(el.uv[0], u, 0) : 0;
    out[r2 + 3] = el.uv ? evalCurve(el.uv[1], u, 0) : 0;
    const r3 = o + S * 12 + i * 4;
    out[r3] = evalCurve(el.move?.x, u, 0);
    out[r3 + 1] = evalCurve(el.move?.y, u, 0);
    out[r3 + 2] = evalCurve(el.move?.z, u, 0);
    out[r3 + 3] = (evalCurve(el.spin, u, 0) * Math.PI) / 180;
  }
}

/**
 * Trail rows (u = position along the trail: 0 at the anchor → 1 at the tail = the point's age / life):
 *  row 0: width taper, 0, 0, 0
 *  row 1: r, g, b, a
 */
export function bakeTrail(el: TrailSpec, out: Float32Array, o: number): void {
  const col = new Float32Array(4);
  for (let i = 0; i < S; i++) {
    const u = i / (S - 1);
    const r0 = o + i * 4;
    out[r0] = evalCurve(el.taper, u, 1);
    out[r0 + 1] = 0;
    out[r0 + 2] = 0;
    out[r0 + 3] = 0;
    evalColor(el.color, u, col);
    const r1 = o + S * 4 + i * 4;
    out[r1] = col[0] as number;
    out[r1 + 1] = col[1] as number;
    out[r1 + 2] = col[2] as number;
    out[r1 + 3] = col[3] as number;
  }
}
