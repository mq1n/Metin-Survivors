// Position-based sampling of the shipped Imagegen tiles (for parts whose uv is not a natural tile frame: skulls, hammered iron, felt).
import type { Texel } from '../../mesh.ts';
import { type Rgb, type Tex, sampleTex } from '../../texlib.ts';

/** planar projection along the dominant axis of the face normal; `m` metres per tile repeat */
export function triTex(t: Texel, T: Tex, m: number): Rgb {
  const ax = Math.abs(t.nf[0]), ay = Math.abs(t.nf[1]), az = Math.abs(t.nf[2]);
  const [x, y, z] = t.p;
  const fp = t.mpt / m;
  if (ay >= ax && ay >= az) return sampleTex(T, x / m, z / m, fp);
  return ax >= az ? sampleTex(T, z / m, -y / m, fp) : sampleTex(T, x / m, -y / m, fp);
}
