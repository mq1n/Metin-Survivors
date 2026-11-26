// Imagegen material tiles (tex_wp_steel / gold / wood / leather / silk / jade / bone / iron_dark) sampled by the weapon bake.
// Each tile is loaded once, made seamless (cross-fade with the half-offset copy), converted to linear RGB and mip-chained so the bake
// can pick a level that matches the texel footprint. Sources: public/assets/textures/weapon/<id>.<hash>.webp when shipped, else the raw

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../core/export/manifest.ts';
import type { Rgb } from '../../core/paint/painter.ts';

export type TileId = 'steel' | 'iron_dark' | 'gold' | 'wood' | 'leather' | 'silk' | 'jade' | 'bone';

const BASE = 512;
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const LUT = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

export class Tile {
  /** mips[0] = BASE x BASE, each next half the size; linear RGB */
  readonly mips: { n: number; d: Float32Array }[] = [];
  /** luminance mean / standard deviation of the base level (linear) */
  mean = 0;
  std = 1;
  constructor(base: Float32Array) {
    this.mips.push({ n: BASE, d: base });
    let s1 = 0, s2 = 0;
    for (let i = 0; i < BASE * BASE; i++) {
      const l = 0.2126 * base[i * 3]! + 0.7152 * base[i * 3 + 1]! + 0.0722 * base[i * 3 + 2]!;
      s1 += l;
      s2 += l * l;
    }
    this.mean = s1 / (BASE * BASE);
    this.std = Math.sqrt(Math.max(1e-9, s2 / (BASE * BASE) - this.mean ** 2));
    for (let n = BASE / 2; n >= 16; n /= 2) {
      const prev = this.mips[this.mips.length - 1]!;
      const d = new Float32Array(n * n * 3);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          for (let c = 0; c < 3; c++) {
            const a = prev.d[((y * 2) * prev.n + x * 2) * 3 + c]!, b = prev.d[((y * 2) * prev.n + x * 2 + 1) * 3 + c]!;
            const e = prev.d[((y * 2 + 1) * prev.n + x * 2) * 3 + c]!, f = prev.d[((y * 2 + 1) * prev.n + x * 2 + 1) * 3 + c]!;
            d[(y * n + x) * 3 + c] = (a + b + e + f) * 0.25;
          }
        }
      }
      this.mips.push({ n, d });
    }
  }

  private bilinear(level: number, u: number, v: number, out: Rgb): void {
    const m = this.mips[level]!;
    const n = m.n;
    const x = (u - Math.floor(u)) * n - 0.5, y = (v - Math.floor(v)) * n - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const xa = ((x0 % n) + n) % n, xb = (xa + 1) % n, ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;
    for (let c = 0; c < 3; c++) {
      const a = m.d[(ya * n + xa) * 3 + c]!, b = m.d[(ya * n + xb) * 3 + c]!, e = m.d[(yb * n + xa) * 3 + c]!, f = m.d[(yb * n + xb) * 3 + c]!;
      out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy;
    }
  }

  /** u, v in tile repeats; `lod` is the (fractional) mip level */
  sample(u: number, v: number, lod = 0): Rgb {
    const l = Math.min(this.mips.length - 1, Math.max(0, lod));
    const l0 = Math.floor(l), t = l - l0;
    const a: Rgb = [0, 0, 0];
    this.bilinear(l0, u, v, a);
    if (t < 0.02 || l0 + 1 >= this.mips.length) return a;
    const b: Rgb = [0, 0, 0];
    this.bilinear(l0 + 1, u, v, b);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** mip level whose texels are about one output texel: tile spans `tileMeters`, output texel = `mPerTexel` metres */
  lodFor(tileMeters: number, mPerTexel: number): number {
    return Math.max(0, Math.log2(BASE / Math.max(1, tileMeters / mPerTexel)));
  }
}

function findSource(id: string): string | null {
  const root = repoRoot();
  const shipped = join(root, 'apps', 'game', 'public', 'assets', 'textures', 'weapon');
  if (existsSync(shipped)) {
    const f = readdirSync(shipped).find((n) => n.startsWith(`tex_wp_${id}.`) && n.endsWith('.webp'));
    if (f) return join(shipped, f);
  }
  const raw = join(root, '.research', 'imagegen', 'raw', `tex_wp_${id}.png`);
  return existsSync(raw) ? raw : null;
}

function load(id: string): Tile | null {
  const src = findSource(id);
  if (!src) return null;
  const r = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', src, '-vf', `scale=${BASE}:${BASE}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdout: 'pipe', stderr: 'pipe' });
  if (!r.success) throw new Error(`tile ${id}: ffmpeg failed ${r.stderr.toString()}`);
  const bytes = r.stdout;
  const lin = new Float32Array(BASE * BASE * 3);
  for (let i = 0; i < lin.length; i++) lin[i] = LUT[bytes[i]!]!;
  // seamless: cross-fade with the half-offset copy; weight 1 in the middle, 0 at the borders
  const out = new Float32Array(lin.length);
  const w = (t: number): number => {
    const k = Math.min(t, 1 - t) * 2; // 0 at the border .. 1 at the centre
    return Math.min(1, k / 0.5);
  };
  for (let y = 0; y < BASE; y++) {
    const wy = w((y + 0.5) / BASE);
    for (let x = 0; x < BASE; x++) {
      const k = wy * w((x + 0.5) / BASE);
      const xo = (x + BASE / 2) % BASE, yo = (y + BASE / 2) % BASE;
      for (let c = 0; c < 3; c++) out[(y * BASE + x) * 3 + c] = lin[(y * BASE + x) * 3 + c]! * k + lin[(yo * BASE + xo) * 3 + c]! * (1 - k);
    }
  }
  return new Tile(out);
}

const cache = new Map<string, Tile | null>();
/** tile by id (null when no source exists: the paint falls back to procedural noise) */
export function tile(id: TileId): Tile | null {
  let t = cache.get(id);
  if (t === undefined) {
    t = load(id);
    cache.set(id, t);
  }
  return t;
}

/** luminance (linear) */
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
