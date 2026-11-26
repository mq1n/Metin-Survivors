// Layout debugger: renders a zone's TerrainField to a PNG (hillshade + ground paint + liquids + blockers + landmarks).
//   bun run apps/game/src/world/debug/dumpLayout.ts <zone> [out.png] [cx cz halfSize] [pxPerMetre]

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BiomePreset, ZoneDef } from '../../data/schema';
import zonesJson from '../../data/content/zones.json';
import { SURFACE } from '../layoutTypes';
import { createTerrainField } from '../terrainField';

const LEGEND = 'layers: 0 green, 1 lime, 2 tan, 3 grey, 4 white, 5 ice, 6 dark, 7 orange | trees green dots, rocks grey, props red, walls magenta, landmarks yellow ring, lava orange, water blue, ice cyan, deep dark blue, blocked = darkened';
const PALETTE: Array<[number, number, number]> = [
  [86, 130, 52],
  [150, 180, 70],
  [176, 148, 96],
  [128, 126, 120],
  [236, 240, 246],
  [150, 205, 235],
  [60, 52, 56],
  [230, 130, 40],
];

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] as number;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, data: Uint8Array): void => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    chunks.push(out);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  chunk('IHDR', ihdr);
  chunk('IDAT', deflateSync(raw, { level: 6 }));
  chunk('IEND', new Uint8Array(0));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = sig.length + chunks.reduce((a, c) => a + c.length, 0);
  const res = new Uint8Array(total);
  res.set(sig, 0);
  let o = sig.length;
  for (const c of chunks) {
    res.set(c, o);
    o += c.length;
  }
  return res;
}

function biomeFor(id: string): BiomePreset {
  const z = (zonesJson as unknown as ZoneDef[]).find((q) => q.id === id);
  if (!z) throw new Error(`unknown zone "${id}"`);
  return z.biome;
}

const [zone = 'yeonmu', outArg, cxArg, czArg, halfArg, pxArg] = process.argv.slice(2);
const field = createTerrainField(biomeFor(zone));
const half = Number(halfArg ?? field.size / 2);
const cx = Number(cxArg ?? 0);
const cz = Number(czArg ?? 0);
const ppm = Number(pxArg ?? (half > 200 ? 2 : 4));
const W = Math.round(half * 2 * ppm);
const rgb = new Uint8Array(W * W * 3);
const paint = field.paint();
const layers = Math.min(8, field.layout.groundLayers.length);
const sun = { x: -0.55, y: 0.6, z: -0.58 };
const nrm = { x: 0, y: 1, z: 0 };

const toPx = (x: number, z: number): [number, number] => [Math.round((x - (cx - half)) * ppm), Math.round((z - (cz - half)) * ppm)];
const put = (px: number, py: number, r: number, g: number, b: number): void => {
  if (px < 0 || py < 0 || px >= W || py >= W) return;
  const o = (py * W + px) * 3;
  rgb[o] = r;
  rgb[o + 1] = g;
  rgb[o + 2] = b;
};
const disc = (x: number, z: number, r: number, col: [number, number, number], ring = false): void => {
  const [px, py] = toPx(x, z);
  const rp = Math.max(1, Math.round(r * ppm));
  for (let dy = -rp; dy <= rp; dy++) {
    for (let dx = -rp; dx <= rp; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (ring ? Math.abs(d - rp) < 1.1 : d <= rp) put(px + dx, py + dy, col[0], col[1], col[2]);
    }
  }
};

for (let py = 0; py < W; py++) {
  const z = cz - half + (py + 0.5) / ppm;
  for (let px = 0; px < W; px++) {
    const x = cx - half + (px + 0.5) / ppm;
    // paint colour (nearest texel)
    const ti = Math.min(paint.res - 1, Math.max(0, Math.floor((x + field.size / 2) / paint.texel)));
    const tj = Math.min(paint.res - 1, Math.max(0, Math.floor((z + field.size / 2) / paint.texel)));
    const o = (tj * paint.res + ti) * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < layers; k++) {
      const w = (k < 4 ? paint.w0[o + k] : paint.w1[o + k - 4]) as number;
      const c = PALETTE[k] as [number, number, number];
      r += c[0] * w;
      g += c[1] * w;
      b += c[2] * w;
    }
    r /= 255;
    g /= 255;
    b /= 255;
    field.normalAt(x, z, nrm);
    const lit = 0.55 + 0.7 * Math.max(0, nrm.x * sun.x + nrm.y * sun.y + nrm.z * sun.z);
    r *= lit;
    g *= lit;
    b *= lit;
    const s = field.surfaceAt(x, z);
    if (s === SURFACE.LAVA) [r, g, b] = [255 * (0.7 + 0.3 * lit), 110 * lit, 20];
    else if (s === SURFACE.DEEP) [r, g, b] = [20, 60 * lit + 20, 120 * lit + 40];
    else if (s === SURFACE.SHALLOW) [r, g, b] = [70 * lit, 140 * lit, 180 * lit];
    else if (s === SURFACE.ICE) [r, g, b] = [150 * lit, 215 * lit, 240 * lit];
    else if (s === SURFACE.MIASMA) [r, g, b] = [r * 0.7, g * 0.95 + 30, b * 0.7];
    if (!field.walkable(x, z) && field.insideBy(x, z) <= 0) {
      r *= 0.55;
      g *= 0.55;
      b *= 0.6;
    } else if (field.insideBy(x, z) > 0 && field.slopeAt(x, z) > 0.84) {
      r *= 0.7;
      g *= 0.7;
      b *= 0.75;
    }
    // contour of the arena boundary
    const inside = field.insideBy(x, z);
    if (Math.abs(inside) < 0.6 / ppm + 0.35) [r, g, b] = [255, 255, 255];
    put(px, py, Math.min(255, r), Math.min(255, g), Math.min(255, b));
  }
}
for (const rk of field.layout.rocks) disc(rk.x, rk.z, Math.max(rk.sx, rk.sz) * 0.5, [150, 150, 150]);
for (const t of field.layout.trees) disc(t.x, t.z, 0.7 * t.scale + 0.4, [24, 90, 30]);
for (const p of field.layout.props) disc(p.x, p.z, 1.6, [230, 40, 40]);
for (const w of field.layout.walls) {
  const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
  for (let i = 0; i <= len * ppm; i++) {
    const t = i / Math.max(1, len * ppm);
    disc(w.x0 + (w.x1 - w.x0) * t, w.z0 + (w.z1 - w.z0) * t, 0.35, [230, 50, 230]);
  }
}
for (const br of field.layout.bridges) {
  const len = Math.hypot(br.x1 - br.x0, br.z1 - br.z0);
  for (let i = 0; i <= len * ppm; i++) {
    const t = i / Math.max(1, len * ppm);
    disc(br.x0 + (br.x1 - br.x0) * t, br.z0 + (br.z1 - br.z0) * t, br.width * 0.5, [180, 120, 60]);
  }
}
for (const l of field.landmarks) {
  disc(l.x, l.z, l.r, [255, 230, 40], true);
  disc(l.x, l.z, 0.8, [255, 230, 40]);
}

const out = outArg ?? `.research/terrain/layout_${zone}.png`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png(W, W, rgb));
const s = field.stats;
console.log(
  `${zone}: ${W}x${W}px -> ${out}\n  bake ${s.bakeMs.toFixed(0)} ms | walkable ${(s.walkableFraction * 100).toFixed(1)} % | reachable ${(s.reachableFraction * 100).toFixed(1)} % | blockers ${s.blockers} | trees ${field.layout.trees.length} rocks ${field.layout.rocks.length} props ${field.layout.props.length} walls ${field.layout.walls.length} bridges ${field.layout.bridges.length}\n  height ${field.heightRange.min.toFixed(1)}..${field.heightRange.max.toFixed(1)} m | arenaRadius ${field.arenaRadius}\n  ${LEGEND}`,
);
