// Static prop pipeline: PropMesh (hard-surface parts with tile uvs) -> weld/crease finish -> xatlas + AO + material bake -> ModelData.
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { repoRoot } from '../../core/export/manifest.ts';
import type { ModelData, ModelKind } from '../../core/model.ts';
import type { BuildOpts, ModelEntry } from '../../core/registry.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { bakeProp, paintPropVertices } from './bake.ts';
import { type Mat, PropMesh } from './mesh.ts';
import { PROP_ALBEDO_QUALITY, PROP_EMISSIVE_QUALITY, propTexMax } from './texCap.ts';
import type { Rgb } from './texlib.ts';

export interface PropDef {
  id: string;
  kind?: ModelKind;
  seed?: string;
  mats: Mat[];
  /** fill the mesh; material indices refer to `mats` */
  build(m: PropMesh): void;
  /** baked texture edge (px). 1024 default; capped at propTexMax(id) (texCap.ts: 1024, 2048 for a landmark; the zone payload carries 14 prop GLBs), so asking for more only costs unwrap time */
  size?: number;
  /** vertical scale applied to the finished geometry (fine-tune height to the PROP_DEFS contract without moving x/z footprint features) */
  yScale?: number;
  /** crease angle (deg) for smooth vs hard normals. Default 38 */
  crease?: number;
  /** AO distances (m) */
  aoShort?: number;
  aoLong?: number;
  rays?: number;
  shadowTint?: Rgb;
  /** occlusion exponent (see BakeOpts.aoGain) */
  aoGain?: number;
  /** PBR defaults 0.88 / 0 */
  material?: { roughness?: number; metallic?: number };
  /** emissive intensity multiplier. glTF caps material.emissiveFactor at 1, so components above 1 are folded into the emissive map
   * (texels multiplied by the largest component before encoding, factor renormalised to max 1) */
  emissiveFactor?: [number, number, number];
  extras?: Record<string, unknown>;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export async function buildProp(def: PropDef, log: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const m = new PropMesh();
  def.build(m);
  if (def.yScale && def.yScale !== 1) for (let i = 1; i < m.tris.length; i += 3) m.tris[i] = m.tris[i]! * def.yScale;
  const fin = m.finish(def.crease ?? 38);
  log(`  geometry: ${fin.indices.length / 3} tris, ${fin.positions.length / 3} verts`);
  if (process.env.FORGE_DEBUG) {
    const per = new Map<number, number>();
    for (let t = 0; t < fin.indices.length / 3; t++) per.set(fin.groups[fin.indices[t * 3]!]!, (per.get(fin.groups[fin.indices[t * 3]!]!) ?? 0) + 1);
    log(`  tris per material: ${[...per.entries()].sort((a, b) => a[0] - b[0]).map(([g, n]) => `${def.mats[g]?.name ?? g}=${n}`).join(' ')}`);
  }
  const size = opts?.texture !== undefined ? opts.texture : def.size ?? 1024;
  if (size <= 0) {
    const colors = paintPropVertices(fin, {
      seed: def.seed ?? def.id,
      mats: def.mats,
      ...(def.aoShort !== undefined ? { aoShort: def.aoShort } : {}),
      ...(def.aoLong !== undefined ? { aoLong: def.aoLong } : {}),
      ...(def.rays !== undefined ? { rays: def.rays } : {}),
      ...(def.shadowTint ? { shadowTint: def.shadowTint } : {}),
      ...(def.aoGain ? { aoGain: def.aoGain } : {}),
    });
    log('  vertex-color build (texture disabled)');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, r2 = 0;
    for (let i = 0; i < fin.positions.length; i += 3) {
      const x = fin.positions[i]!, y = fin.positions[i + 1]!, z = fin.positions[i + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      r2 = Math.max(r2, x * x + z * z);
    }
    return {
      id: def.id,
      kind: def.kind ?? 'prop',
      positions: fin.positions,
      normals: fin.normals,
      colors,
      indices: fin.indices,
      ...(def.material ? { material: def.material } : {}),
      clips: [],
      height: maxY,
      radius: Math.sqrt(r2),
      extras: { ...(def.extras ?? {}), bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
    };
  }
  const ef = def.emissiveFactor ?? [1, 1, 1];
  const eGain = Math.max(1, ...ef);
  const baked = await bakeProp(fin, {
    size,
    max: propTexMax(def.id),
    seed: def.seed ?? def.id,
    mats: def.mats,
    ...(def.aoShort !== undefined ? { aoShort: def.aoShort } : {}),
    ...(def.aoLong !== undefined ? { aoLong: def.aoLong } : {}),
    ...(def.rays !== undefined ? { rays: def.rays } : {}),
    ...(def.shadowTint ? { shadowTint: def.shadowTint } : {}),
    ...(def.aoGain ? { aoGain: def.aoGain } : {}),
    ...(eGain > 1 ? { emissiveGain: eGain } : {}),
    log,
  });
  if (process.env.FORGE_DEBUG) {
    const dir = join(repoRoot(), '.research', 'forge', def.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'albedo.png'), encodePng(baked.albedo.rgba, baked.albedo.w, baked.albedo.h));
    if (baked.emissive) writeFileSync(join(dir, 'emissive.png'), encodePng(baked.emissive.rgba, baked.emissive.w, baked.emissive.h));
  }
  const layout = layoutHash(baked.positions, baked.uvs, baked.indices);
  const painted = loadPaintedTexture(def.id, layout, log);
  const albedo = painted ? painted.webp : encodeWebp(baked.albedo.rgba, baked.albedo.w, baked.albedo.h, PROP_ALBEDO_QUALITY);
  const texW = painted ? painted.width || baked.albedo.w : baked.albedo.w, texH = painted ? painted.height || baked.albedo.h : baked.albedo.h;
  log(`  albedo ${texW}x${texH} -> ${(albedo.length / 1024).toFixed(0)} KB${painted ? ' (painted)' : ''}`);
  let emissive: ModelData['emissive'];
  if (baked.emissive) {
    const e = encodeWebp(baked.emissive.rgba, baked.emissive.w, baked.emissive.h, PROP_EMISSIVE_QUALITY);
    emissive = { webp: e, width: baked.emissive.w, height: baked.emissive.h };
    log(`  emissive -> ${(e.length / 1024).toFixed(0)} KB`);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, r2 = 0;
  for (let i = 0; i < baked.positions.length; i += 3) {
    const x = baked.positions[i]!, y = baked.positions[i + 1]!, z = baked.positions[i + 2]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    r2 = Math.max(r2, x * x + z * z);
  }
  return {
    id: def.id,
    kind: def.kind ?? 'prop',
    positions: baked.positions,
    normals: baked.normals,
    colors: baked.colors,
    indices: baked.indices,
    uvs: baked.uvs,
    texture: { webp: albedo, width: texW, height: texH },
    ...(emissive ? { emissive, emissiveFactor: ef.map((c) => c / eGain) as [number, number, number] } : {}),
    ...(def.material ? { material: def.material } : {}),
    clips: [],
    height: maxY,
    radius: Math.sqrt(r2),
    extras: { ...(def.extras ?? {}), layoutHash: layout, bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
  };
}

export const propEntry = (def: PropDef): ModelEntry => ({ id: def.id, kind: def.kind ?? 'prop', build: (log, opts) => buildProp(def, log, opts) });
