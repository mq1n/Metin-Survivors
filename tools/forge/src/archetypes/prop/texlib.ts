// Tileable-texture library for prop baking: loads the shipped Imagegen albedo textures (public/assets/manifest/textures.json),
// keeps linear-light mip chains and samples them trilinearly with wrap, so a bake at 3 cm/texel does not alias a 1 cm/px tile.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../core/export/manifest.ts';

export type Rgb = [number, number, number];

export interface Tex {
  id: string;
  size: number;
  /** linear RGB float mips, level 0 = full size */
  mips: Float32Array[];
  /** average linear colour */
  avg: Rgb;
}

const s2l = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  s2l[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const cache = new Map<string, Tex | null>();
let manifest: Record<string, { url: string }> | null = null;

function loadManifest(): Record<string, { url: string }> {
  if (manifest) return manifest;
  const p = join(repoRoot(), 'apps', 'game', 'public', 'assets', 'manifest', 'textures.json');
  manifest = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { url: string }>;
  return manifest;
}

/** is a shipped texture with this id available? (cheap; reads the manifest fresh when the id is unknown) */
export function hasTex(id: string): boolean {
  if (loadManifest()[id]) return true;
  manifest = null;
  return !!loadManifest()[id];
}

/** load + mip a shipped square texture; returns null when the id does not exist (callers fall back to procedural) */
export function loadTex(id: string): Tex | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  if (!hasTex(id)) {
    cache.set(id, null);
    return null;
  }
  const entry = loadManifest()[id]!;
  const file = join(repoRoot(), 'apps', 'game', 'public', entry.url);
  if (!existsSync(file)) {
    cache.set(id, null);
    return null;
  }
  const info = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = info.stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error(`ffprobe failed for ${file}: ${info.stderr}`);
  // power-of-two square working size (resample if needed)
  const size = 1 << Math.round(Math.log2(Math.min(w, h)));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${size}:${size}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: size * size * 3 + 1024 });
  if (r.status !== 0 || r.stdout.length < size * size * 3) throw new Error(`ffmpeg decode failed for ${file}: ${r.stderr?.toString()}`);
  const raw = r.stdout as unknown as Uint8Array;
  const l0 = new Float32Array(size * size * 3);
  const avg: Rgb = [0, 0, 0];
  for (let i = 0; i < size * size * 3; i++) {
    l0[i] = s2l[raw[i]!]!;
    avg[i % 3] = avg[i % 3]! + l0[i]!;
  }
  for (let k = 0; k < 3; k++) avg[k] = avg[k]! / (size * size);
  const mips = [l0];
  for (let s = size >> 1; s >= 1; s >>= 1) {
    const prev = mips[mips.length - 1]!;
    const ps = s * 2;
    const m = new Float32Array(s * s * 3);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        for (let c = 0; c < 3; c++) {
          m[(y * s + x) * 3 + c] =
            (prev[((2 * y) * ps + 2 * x) * 3 + c]! + prev[((2 * y) * ps + 2 * x + 1) * 3 + c]! + prev[((2 * y + 1) * ps + 2 * x) * 3 + c]! + prev[((2 * y + 1) * ps + 2 * x + 1) * 3 + c]!) * 0.25;
        }
      }
    }
    mips.push(m);
  }
  const tex: Tex = { id, size, mips, avg };
  cache.set(id, tex);
  return tex;
}

function bilerp(tex: Tex, level: number, u: number, v: number, out: Rgb): void {
  const s = tex.size >> level;
  const m = tex.mips[level]!;
  const fx = (u - Math.floor(u)) * s - 0.5, fy = (v - Math.floor(v)) * s - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const xa = ((x0 % s) + s) % s, xb = (xa + 1) % s, ya = ((y0 % s) + s) % s, yb = (ya + 1) % s;
  for (let c = 0; c < 3; c++) {
    const a = m[(ya * s + xa) * 3 + c]!, b = m[(ya * s + xb) * 3 + c]!, d = m[(yb * s + xa) * 3 + c]!, e = m[(yb * s + xb) * 3 + c]!;
    out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  }
}

const tmpA: Rgb = [0, 0, 0], tmpB: Rgb = [0, 0, 0];

/**
 * Trilinear wrap sample. (u,v) are in tile units (1 = one repeat). `footprint` = texel size of the *target* in tile units
 * (used to pick the mip so the bake does not alias); 0 = full resolution.
 */
export function sampleTex(tex: Tex, u: number, v: number, footprint = 0): Rgb {
  const lod = footprint > 0 ? Math.log2(footprint * tex.size) : 0;
  const maxL = tex.mips.length - 1;
  const l = Math.min(maxL, Math.max(0, lod));
  const l0 = Math.floor(l);
  bilerp(tex, l0, u, v, tmpA);
  const f = l - l0;
  if (f < 0.02 || l0 >= maxL) return [tmpA[0], tmpA[1], tmpA[2]];
  bilerp(tex, l0 + 1, u, v, tmpB);
  return [tmpA[0] + (tmpB[0] - tmpA[0]) * f, tmpA[1] + (tmpB[1] - tmpA[1]) * f, tmpA[2] + (tmpB[2] - tmpA[2]) * f];
}
