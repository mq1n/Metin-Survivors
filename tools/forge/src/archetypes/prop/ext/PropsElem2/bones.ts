// Bone work for the PropsElem2 props: a low-poly human skull (egg cranium + tapered face block) placed in an explicit frame, a
// registry of placed skulls so materials can paint eye sockets, nose hole and teeth in skull-local coordinates, and an aged-bone
// material whose sockets can glow (plague / ember palettes).
import type { Mat4, Vec3 } from '../../../../core/math.ts';
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { extrude } from '../../../../core/hard/hardmesh.ts';
import type { Mapper, Mat, PropMesh, Texel } from '../../mesh.ts';
import { fbm01, lum, mixc, mulc, pickTex, rgb } from '../../mats.ts';
import type { Rgb } from '../../texlib.ts';
import { memo1, noiseBump, triSample, veins } from '../PropsElem/paint.ts';
import { type FirePal, heatOf } from './fire.ts';
import { lathe2 } from './geo.ts';

export interface SkullFrame {
  /** cranium centre */
  o: Vec3;
  /** unit axes: x = skull's right, y = up, z = facing direction */
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** cranium radius (m) */
  s: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** skull frame facing `fwd` (tilted by `pitch`, + looks down) at `o` */
export function skullFrame(o: Vec3, fwd: Vec3, s: number, pitch = 0, roll = 0): SkullFrame {
  const z0 = norm([fwd[0], 0, fwd[2]]);
  const y0: Vec3 = [0, 1, 0];
  const x0 = norm(cross(y0, z0));
  // pitch about the right axis (+ = nose down)
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const z1: Vec3 = [z0[0] * cp - y0[0] * sp, z0[1] * cp - y0[1] * sp, z0[2] * cp - y0[2] * sp];
  const y1: Vec3 = [y0[0] * cp + z0[0] * sp, y0[1] * cp + z0[1] * sp, y0[2] * cp + z0[2] * sp];
  // roll about the facing axis
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x: Vec3 = [x0[0] * cr + y1[0] * sr, x0[1] * cr + y1[1] * sr, x0[2] * cr + y1[2] * sr];
  const y: Vec3 = [y1[0] * cr - x0[0] * sr, y1[1] * cr - x0[1] * sr, y1[2] * cr - x0[2] * sr];
  return { o, x: norm(x), y: norm(y), z: norm(z1), s };
}

const frameXf = (f: SkullFrame): Mat4 => [f.x[0] * f.s, f.x[1] * f.s, f.x[2] * f.s, 0, f.y[0] * f.s, f.y[1] * f.s, f.y[2] * f.s, 0, f.z[0] * f.s, f.z[1] * f.s, f.z[2] * f.s, 0, f.o[0], f.o[1], f.o[2], 1];

/** world-space planar mapper (metres, dominant axis) for small parts */
export const mapWorld: Mapper = (a, b, c, n) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: Vec3): [number, number] => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], -p[1]] : [p[0], -p[1]]);
  return [f(a), f(b), f(c)];
};

/** front-view outline of the face block (cheekbones, upper jaw, chin), x right, y up, in cranium radii */
const FACE: [number, number][] = [[-0.6, -0.15], [-0.68, -0.5], [-0.46, -0.78], [-0.36, -1.12], [0.36, -1.12], [0.46, -0.78], [0.68, -0.5], [0.6, -0.15]];

/** low-poly human skull in frame `f` (about 90 triangles); returns the frame for painting */
export function skull(m: PropMesh, mat: number, f: SkullFrame): SkullFrame {
  const M = frameXf(f);
  const from = m.triCount;
  lathe2(m, mat, [[0, -0.5], [0.66, -0.32], [0.97, 0.06], [0.9, 0.48], [0.58, 0.84], [0, 0.96]], 8, { map: mapWorld });
  // stretch the cranium front to back
  m.deform(from, (p) => [p[0] * 0.9, p[1], p[2] * 1.12]);
  m.add(extrude(FACE, 0.78, { axis: 'z', z0: 0.28, taper: 0.86 }), mat, mapWorld);
  m.transformFrom(from, M);
  return f;
}

export interface SkullMarks {
  /** 0..1 inside an eye socket */
  socket: number;
  /** 0..1 nose cavity */
  nose: number;
  /** 0..1 tooth gaps */
  teeth: number;
  /** 0..1 on the face side of the skull */
  front: number;
}

const NONE: SkullMarks = { socket: 0, nose: 0, teeth: 0, front: 0 };

/** marks of the nearest registered skull at a world point */
export function skullMarks(p: Vec3, skulls: readonly SkullFrame[]): SkullMarks {
  for (const f of skulls) {
    const d: Vec3 = [p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]];
    const lx = dot(d, f.x) / f.s, ly = dot(d, f.y) / f.s, lz = dot(d, f.z) / f.s;
    if (Math.abs(lx) > 1.3 || ly > 1.2 || ly < -1.4 || Math.abs(lz) > 1.5) continue;
    const front = smoothstep(0.35, 0.75, lz);
    if (front <= 0) return NONE;
    const ax = Math.abs(lx);
    const socket = (1 - smoothstep(0.85, 1.05, Math.hypot((ax - 0.3) / 0.25, (ly + 0.28) / 0.21))) * front;
    const nose = (1 - smoothstep(0.0, 0.03, Math.max(ax * 1.6 + (ly + 0.52) * 0.8 - 0.13, -(ly + 0.68)))) * front;
    const inRow = ly < -0.82 && ly > -1.04 && ax < 0.36 ? 1 : 0;
    const teeth = inRow * Math.max(1 - smoothstep(0.012, 0.03, Math.abs(((lx + 1) % 0.14) - 0.07) - 0.045), 1 - smoothstep(0.01, 0.025, Math.abs(ly + 0.93))) * front;
    return { socket, nose, teeth, front };
  }
  return NONE;
}

export interface BoneMatOpts {
  skulls: readonly SkullFrame[];
  /** socket glow palette + strength (0 = dark empty sockets) */
  pal?: FirePal;
  glow?: number;
  /** grime / soot from below and in crevices 0..1 */
  grime?: number;
  /** tint of the bone (aged ivory by default) */
  tint?: string;
}

/** aged bone: ivory with brown grime in the crevices, hairline cracks, dark (or glowing) sockets */
export function boneMat(name: string, o: BoneMatOpts): Mat {
  const T = pickTex('tex_bone_ivory');
  const avg = T ? Math.max(1e-3, lum(T.avg)) : 1;
  const tint = rgb(o.tint ?? '#d9cba6'), grime = rgb('#4a3a26'), hole = rgb('#120c08');
  const mk = memo1((t: Texel) => skullMarks(t.p, o.skulls));
  return {
    name,
    shade(t) {
      let c: Rgb = T ? mulc(tint, 0.55 + 0.45 * (lum(triSample(t, T, 3)) / avg)) : mulc(tint, 0.8 + 0.3 * fbm01(t, 12, 3));
      c = mulc(c, noiseBump(t, 30, 0.18, 2, 2));
      c = mixc(c, grime, clamp01((1 - t.ao) * 1.3 * (o.grime ?? 0.6) + fbm01(t, 9, 3, 1.4) * 0.2 - 0.05));
      c = mulc(c, 1 - 0.6 * veins(t, 14, 0.0015, 3, 0.5));
      c = mixc(c, mulc(tint, 1.15), smoothstep(0.3, 0.7, t.edge) * 0.35);
      const s = mk(t);
      const cav = Math.max(s.socket, s.nose, s.teeth * 0.8);
      if (cav > 0) c = mixc(c, hole, cav);
      if (o.pal && o.glow && s.socket > 0) c = mixc(c, mulc(heatOf(o.pal, 0.7), 0.4), s.socket * 0.6);
      return c;
    },
    ...(o.pal && o.glow
      ? {
          emit(t: Texel): Rgb | null {
            const s = mk(t);
            const g = s.socket * (o.glow ?? 0);
            return g < 0.01 ? null : heatOf(o.pal!, 0.35 + 0.55 * g);
          },
        }
      : {}),
  };
}
