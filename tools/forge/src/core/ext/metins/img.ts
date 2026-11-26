// Decode shipped WebP textures (manifest/textures.json ids) through ffmpeg and sample them bilinearly: used to bake
// Imagegen's rune sheets / obsidian into the metin GLB atlases. Pure CPU, deterministic, cached per process.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../export/manifest.ts';

export interface Img {
  w: number;
  h: number;
  /** RGBA8, row 0 = top */
  data: Uint8Array;
}

const cache = new Map<string, Img>();

export function decodeImage(file: string): Img {
  const hit = cache.get(file);
  if (hit) return hit;
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [ws, hs] = probe.stdout.trim().split(',');
  const w = Number(ws), h = Number(hs);
  if (!(w > 0 && h > 0)) throw new Error(`ffprobe could not read ${file}: ${probe.stderr}`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: w * h * 4 + 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${String(r.stderr)}`);
  const img: Img = { w, h, data: new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, w * h * 4) };
  cache.set(file, img);
  return img;
}

/** shipped texture by manifest id (public/assets/manifest/textures.json) */
export function loadTexture(id: string): Img {
  const pub = join(repoRoot(), 'apps', 'game', 'public');
  const root = join(pub, 'assets');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest', 'textures.json'), 'utf8')) as Record<string, { url: string }>;
  const e = manifest[id];
  if (!e) throw new Error(`texture ${id} is not in manifest/textures.json`);
  return decodeImage(join(pub, e.url));
}

/** bilinear sample of channel `ch` (0..3) in 0..1. u,v in 0..1 (v down). `wrap` repeats, otherwise clamps and returns 0 outside */
export function sample(img: Img, u: number, v: number, ch: number, wrap: boolean): number {
  let x = u * img.w - 0.5, y = v * img.h - 0.5;
  if (!wrap && (u < 0 || u > 1 || v < 0 || v > 1)) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (xi: number, yi: number): number => {
    if (wrap) {
      xi = ((xi % img.w) + img.w) % img.w;
      yi = ((yi % img.h) + img.h) % img.h;
    } else {
      xi = Math.min(img.w - 1, Math.max(0, xi));
      yi = Math.min(img.h - 1, Math.max(0, yi));
    }
    return img.data[(yi * img.w + xi) * 4 + ch]! / 255;
  };
  x = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const x2 = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return x * (1 - fy) + x2 * fy;
}

/** crop a sub-rectangle (pixels) into its own Img */
export function crop(img: Img, x: number, y: number, w: number, h: number): Img {
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const s = ((y + j) * img.w + x + i) * 4;
    data.set(img.data.subarray(s, s + 4), (j * w + i) * 4);
  }
  return { w, h, data };
}
