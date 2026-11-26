// Painted-texture cache hook (tools/painter writes, forge reads).
// A painted albedo is only valid for the exact UV layout + geometry it was painted on, so it is keyed by `layoutHash`.


// The hash is published in the GLB scene extras (`layoutHash`) so a painter reading a forge GLB can store it in meta.json.
// On a hash match the procedural bake is skipped and the painted texture ships; on mismatch forge warns and bakes procedurally.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../export/manifest.ts';

export interface PaintedTexture {
  webp: Uint8Array;
  width: number;
  height: number;
}

/** FNV-1a over positions (0.1 mm), UVs (1/8192) and indices */
export function layoutHash(positions: Float32Array, uvs: Float32Array, indices: Uint32Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef;
  const mix = (v: number): void => {
    h1 = Math.imul(h1 ^ (v & 0xff), 0x01000193);
    h1 = Math.imul(h1 ^ ((v >>> 8) & 0xff), 0x01000193);
    h1 = Math.imul(h1 ^ ((v >>> 16) & 0xff), 0x01000193);
    h1 = Math.imul(h1 ^ ((v >>> 24) & 0xff), 0x01000193);
    h2 = Math.imul((h2 ^ v) >>> 0, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  };
  for (let i = 0; i < positions.length; i++) mix(Math.round(positions[i]! * 10000));
  for (let i = 0; i < uvs.length; i++) mix(Math.round(uvs[i]! * 8192));
  for (let i = 0; i < indices.length; i++) mix(indices[i]!);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0').slice(0, 4);
}

export const paintedCacheDir = (id: string): string => join(repoRoot(), '.research', 'painter', 'cache', id);

export function loadPaintedTexture(id: string, hash: string, log: (s: string) => void): PaintedTexture | null {
  if (process.env.FORGE_PAINTED === '0') return null;
  const dir = paintedCacheDir(id);
  const metaPath = join(dir, 'meta.json'), imgPath = join(dir, 'albedo.webp');
  if (!existsSync(metaPath) || !existsSync(imgPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { layoutHash?: string; width?: number; height?: number };
  if (meta.layoutHash !== hash) {
    log(`  painted texture for ${id} is STALE (layoutHash ${meta.layoutHash} != ${hash}); using the procedural bake. Re-run the painter on this build.`);
    return null;
  }
  const bytes = readFileSync(imgPath);
  return { webp: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), width: meta.width ?? 0, height: meta.height ?? 0 };
}
