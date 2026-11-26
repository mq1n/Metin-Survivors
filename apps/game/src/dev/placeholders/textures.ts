// DEV-only: tileable painterly stand-in textures (typed-array DataTextures; no DOM/canvas, so they also work under node).
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, type Texture } from 'three';
import { clamp, hashString, smoothstep, tileFbm2, tileNoise2, type RGB } from './math';
import { rgb } from './sdf';

type Ramp = readonly [number, RGB][];

function ramp(stops: Ramp, t: number): RGB {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i] as [number, RGB];
    if (x <= b[0]) {
      const a = stops[i - 1] as [number, RGB];
      const k = (x - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k];
    }
  }
  return (stops[stops.length - 1] as [number, RGB])[1];
}

const toByte = (linear: number): number => Math.round(clamp(Math.pow(clamp(linear, 0, 1), 1 / 2.2), 0, 1) * 255);

/** tileable cellular noise: returns distance to the nearest feature point (0..~1) and the cell id hash */
function cells(x: number, y: number, period: number, seed: number): { d: number; id: number } {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const h1 = tileNoise2(wx + 0.5, wy + 0.5, period * 2, seed);
      const h2 = tileNoise2(wx + 17.5, wy + 3.5, period * 2, seed + 9);
      const px = cx + h1;
      const py = cy + h2;
      const d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d;
        id = h1 * 7.31 + h2 * 3.17;
      }
    }
  }
  return { d: best, id: id - Math.floor(id) };
}

type Painter = (u: number, v: number, seed: number) => [number, number, number, number];

const GRASS: Ramp = [[0, rgb('#26421f')], [0.45, rgb('#4a7430')], [0.75, rgb('#6f9c3c')], [1, rgb('#9cc25a')]];
const DIRT: Ramp = [[0, rgb('#3a2a1c')], [0.5, rgb('#6b4e33')], [1, rgb('#9a7a52')]];
const SAND: Ramp = [[0, rgb('#a8895a')], [0.5, rgb('#d3b980')], [1, rgb('#ecd9a6')]];
const SNOW: Ramp = [[0, rgb('#aebccf')], [0.5, rgb('#dde6f0')], [1, rgb('#ffffff')]];
const STONE: Ramp = [[0, rgb('#3e4044')], [0.5, rgb('#70747a')], [1, rgb('#a3a59f')]];
const BARK: Ramp = [[0, rgb('#2a1c12')], [0.5, rgb('#5a3f2a')], [1, rgb('#86654a')]];

const grass: Painter = (u, v, s) => {
  const big = tileFbm2(u * 4, v * 4, 4, 3, s);
  const mid = tileFbm2(u * 16, v * 16, 16, 3, s + 1);
  const fine = tileFbm2(u * 64, v * 64, 64, 2, s + 2);
  const blade = tileNoise2(u * 128, v * 24, 24, s + 3);
  const t = 0.42 * big + 0.33 * mid + 0.15 * fine + 0.1 * blade;
  const c = ramp(GRASS, t * 1.15 - 0.05);
  const flower = smoothstep(0.9, 0.95, tileNoise2(u * 96, v * 96, 96, s + 7));
  return [c[0] + flower * 0.35, c[1] + flower * 0.3, c[2] + flower * 0.05, 1];
};

const dirt: Painter = (u, v, s) => {
  const t = 0.5 * tileFbm2(u * 5, v * 5, 5, 4, s) + 0.3 * tileFbm2(u * 24, v * 24, 24, 3, s + 1) + 0.2 * tileNoise2(u * 96, v * 96, 96, s + 2);
  const c = ramp(DIRT, t * 1.2 - 0.1);
  const pebble = smoothstep(0.82, 0.88, tileNoise2(u * 48, v * 48, 48, s + 5));
  return [c[0] + pebble * 0.1, c[1] + pebble * 0.1, c[2] + pebble * 0.1, 1];
};

const sand: Painter = (u, v, s) => {
  const ripple = 0.5 + 0.5 * Math.sin((v * 12 + tileFbm2(u * 6, v * 6, 6, 3, s) * 3) * Math.PI * 2);
  const t = 0.5 * tileFbm2(u * 6, v * 6, 6, 3, s + 1) + 0.3 * ripple + 0.2 * tileNoise2(u * 120, v * 120, 120, s + 2);
  const c = ramp(SAND, t);
  return [c[0], c[1], c[2], 1];
};

const snow: Painter = (u, v, s) => {
  const t = 0.6 * tileFbm2(u * 5, v * 5, 5, 3, s) + 0.4 * tileFbm2(u * 20, v * 20, 20, 3, s + 1);
  const c = ramp(SNOW, t * 1.2);
  const sparkle = smoothstep(0.92, 0.97, tileNoise2(u * 140, v * 140, 140, s + 4));
  return [c[0] + sparkle * 0.3, c[1] + sparkle * 0.3, c[2] + sparkle * 0.3, 1];
};

const stone: Painter = (u, v, s) => {
  const warp = tileFbm2(u * 8, v * 8, 8, 2, s) * 0.5;
  const cell = cells(u * 6 + warp, v * 6 + warp, 6, s + 3);
  const base = 0.35 + 0.4 * cell.id + 0.25 * tileFbm2(u * 20, v * 20, 20, 3, s + 1);
  const c = ramp(STONE, base);
  const k = 0.55 + 0.45 * smoothstep(0.02, 0.1, 0.72 - cell.d);
  return [c[0] * k, c[1] * k, c[2] * k, 1];
};

const bark: Painter = (u, v, s) => {
  const t = 0.6 * tileNoise2(u * 18, v * 3, 18, s) + 0.4 * tileFbm2(u * 10, v * 4, 10, 3, s + 1);
  const c = ramp(BARK, t * 1.2 - 0.05);
  return [c[0], c[1], c[2], 1];
};

const lava: Painter = (u, v, s) => {
  const warp = tileFbm2(u * 6, v * 6, 6, 3, s) * 0.6;
  const cell = cells(u * 5 + warp, v * 5 + warp, 5, s + 3);
  const vein = 1 - smoothstep(0.0, 0.16, Math.abs(0.55 - cell.d));
  const rock = 0.06 + 0.1 * tileFbm2(u * 24, v * 24, 24, 3, s + 1);
  return [rock + vein * 1.6, rock * 0.9 + vein * 0.55, rock * 0.8 + vein * 0.08, 1];
};

const glow: Painter = (u, v) => {
  const d = Math.hypot(u - 0.5, v - 0.5) * 2;
  const a = Math.pow(clamp(1 - d, 0, 1), 2.2);
  const core = Math.pow(clamp(1 - d * 2.2, 0, 1), 2);
  return [1, 1, 1, clamp(a * 0.85 + core * 0.5, 0, 1)];
};

const foliage: Painter = (u, v, s) => {
  // leafy cluster card: soft blobs with a darker inner / lighter tip gradient and alpha cutout
  const d = Math.hypot((u - 0.5) * 1.1, (v - 0.46) * 1.0) * 2;
  const n = tileFbm2(u * 8, v * 8, 8, 3, s);
  const mask = smoothstep(1.0, 0.82, d + (n - 0.5) * 0.5);
  const c = ramp(GRASS, 0.35 + 0.5 * n + 0.2 * (v - 0.3));
  return [c[0], c[1], c[2], mask];
};

const rune: Painter = (u, v, s) => {
  const d = Math.hypot(u - 0.5, v - 0.5) * 2;
  const ring = 1 - smoothstep(0.0, 0.035, Math.abs(d - 0.82));
  const ring2 = 1 - smoothstep(0.0, 0.02, Math.abs(d - 0.62));
  const ang = Math.atan2(v - 0.5, u - 0.5);
  const spokes = (1 - smoothstep(0.0, 0.05, Math.abs(Math.sin(ang * 6)))) * smoothstep(0.55, 0.6, d) * smoothstep(0.82, 0.78, d);
  const glyph = smoothstep(0.55, 0.6, tileNoise2(Math.cos(ang) * 4 + 8, d * 8, 16, s)) * smoothstep(0.84, 0.8, d) * smoothstep(0.62, 0.66, d);
  const a = clamp(ring + ring2 * 0.7 + spokes * 0.8 + glyph * 0.8, 0, 1);
  return [1, 1, 1, a];
};

const neutral: Painter = (u, v, s) => {
  const t = 0.55 + 0.25 * tileFbm2(u * 4, v * 4, 4, 3, s) + 0.1 * (v - 0.5);
  return [t, t, t * 1.02, 1];
};

function pick(id: string): { paint: Painter; srgb: boolean; tile: boolean } {
  const k = id.toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => k.includes(x));
  if (has('vfx', 'glow', 'spark', 'smoke', 'flare', 'soft', 'orb')) return { paint: glow, srgb: true, tile: false };
  if (has('rune', 'glyph', 'sigil')) return { paint: rune, srgb: true, tile: false };
  if (has('foliage', 'leaf', 'leaves', 'canopy')) return { paint: foliage, srgb: true, tile: false };
  if (has('lava', 'magma', 'ember')) return { paint: lava, srgb: true, tile: true };
  if (has('snow', 'ice', 'frost')) return { paint: snow, srgb: true, tile: true };
  if (has('sand', 'desert', 'dune')) return { paint: sand, srgb: true, tile: true };
  if (has('bark', 'wood', 'trunk')) return { paint: bark, srgb: true, tile: true };
  if (has('stone', 'rock', 'cobble', 'road', 'brick', 'cliff')) return { paint: stone, srgb: true, tile: true };
  if (has('dirt', 'mud', 'path', 'soil', 'ground')) return { paint: dirt, srgb: true, tile: true };
  if (has('grass', 'terrain', 'tex_', 'meadow', 'field')) return { paint: grass, srgb: true, tile: true };
  return { paint: neutral, srgb: true, tile: true };
}

/** Small tileable/gradient stand-in texture (256², sRGB, mipmapped). Terrain-ish ids get grass; unknown ids get neutral grey. */
export function makePlaceholderTexture(id: string, size = 256): Texture {
  const { paint, tile } = pick(id);
  const seed = hashString(id) & 0xffff;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint((x + 0.5) / size, (y + 0.5) / size, seed);
      const o = (y * size + x) * 4;
      data[o] = toByte(r);
      data[o + 1] = toByte(g);
      data[o + 2] = toByte(b);
      data[o + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  if (tile) tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.name = `placeholder_${id}`;
  return tex;
}
