// Hero/humanoid build pipeline: SDF body -> surface nets -> cleanup -> simplify (face/hands focus) -> relax -> normals ->
// skin weights -> xatlas UVs -> albedo (+ optional emissive) bake -> clips. Same stages as core/build.ts, plus an emissive
// map, kind override and per-hero material parameters, so the shared core stays untouched.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ClipSpec, sampleClip } from '../../core/anim/clip.ts';
import { dominantColors, repoRoot } from '../../core/export/manifest.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { type FocusRegion, orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals, simplify } from '../../core/mesh/simplify.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { meshSdf } from '../../core/mesh/surfaceNets.ts';
import type { ModelData, ModelKind } from '../../core/model.ts';
import { bakeAlbedo } from '../../core/paint/bake.ts';
import { type PaintLayer, paintMesh, rgb } from '../../core/paint/painter.ts';
import type { Body } from '../../core/sdf/body.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type SkinOpts, computeSkinWeights } from '../../core/skin/weights.ts';

export interface HeroDef {
  id: string;
  kind: ModelKind;
  skeleton: Skeleton;
  body: Body;
  paint: {
    albedo: PaintLayer[];
    shade: PaintLayer[];
    /** layers evaluated on a black base into the emissive map (rune glow, lamps) */
    emissive?: PaintLayer[];
    size: number;
    quality?: number;
  };
  clips: ClipSpec[];
  mesh: { voxel: number; tris: number; focus?: FocusRegion[]; relax?: number; project?: number; normalStep?: number; minComponentTris?: number };
  skin?: SkinOpts;
  sockets: Record<string, string>;
  seed: number | string;
  radius?: number;
  extras?: Record<string, unknown>;
  material?: { roughness?: number; metallic?: number };
  emissiveFactor?: [number, number, number];
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export async function buildHero(def: HeroDef, log: (s: string) => void = () => {}): Promise<ModelData> {
  const ms: Record<string, number> = {};
  const lap = (k: string, t0: number): void => {
    ms[k] = Math.round(performance.now() - t0);
  };
  const full = def.body.sdf(false);
  let t = performance.now();
  let mesh = meshSdf(full, { voxel: def.mesh.voxel, bounds: full.bounds() });
  lap('mesh', t);
  log(`  surface nets: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris (${ms.mesh}ms)`);

  t = performance.now();
  mesh = removeSmallComponents(mesh, def.mesh.minComponentTris ?? 60);
  mesh = await simplify(mesh, { targetTris: def.mesh.tris, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
  lap('simplify', t);
  log(`  simplified: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris (${ms.simplify}ms)`);

  t = performance.now();
  if ((def.mesh.relax ?? 0) > 0) mesh = relax(mesh, full, def.mesh.relax ?? 0, 0.4);
  const positions = projectToSurface(mesh.positions, full, def.mesh.project ?? 2);
  const normals = sdfNormals(positions, full, def.mesh.normalStep ?? 0.006);
  const flips = orientToNormals(mesh.indices, positions, normals);
  if (flips > 0) log(`  re-oriented ${flips} flipped triangles`);
  lap('relax+normals', t);

  t = performance.now();
  const skin = computeSkinWeights(positions, mesh.indices, def.body, def.skeleton, def.skin);
  lap('skin', t);

  const S = def.paint.size;
  let outPositions = positions, outNormals = normals, outIndices = mesh.indices;
  let outJoints = skin.joints, outWeights = skin.weights;
  let colors: Float32Array;
  let uvs: Float32Array | undefined;
  let texture: ModelData['texture'];
  let emissive: ModelData['emissive'];
  let layout: string | undefined;

  if (S > 0) {
    // UV unwrap
    t = performance.now();
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a0 = mesh.indices[i]! * 3, b0 = mesh.indices[i + 1]! * 3, c0 = mesh.indices[i + 2]! * 3;
      const ux = positions[b0]! - positions[a0]!, uy = positions[b0 + 1]! - positions[a0 + 1]!, uz = positions[b0 + 2]! - positions[a0 + 2]!;
      const wx = positions[c0]! - positions[a0]!, wy = positions[c0 + 1]! - positions[a0 + 1]!, wz = positions[c0 + 2]! - positions[a0 + 2]!;
      area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    }
    const tpu = Math.sqrt((0.55 * S * S) / area);
    const atlas = await unwrap(positions, mesh.indices, { texelsPerUnit: tpu });
    lap('unwrap', t);
    const nv2 = atlas.positions.length / 3;
    log(`  unwrapped: ${nv2} verts (+${nv2 - positions.length / 3} seam dupes), atlas ${atlas.width}x${atlas.height} (${ms.unwrap}ms)`);
    const remapF = (src: Float32Array, stride: number): Float32Array => {
      const o = new Float32Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) o.set(src.subarray(atlas.oldIndex[v]! * stride, atlas.oldIndex[v]! * stride + stride), v * stride);
      return o;
    };
    const remapU8 = (src: Uint8Array, stride: number): Uint8Array => {
      const o = new Uint8Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) o.set(src.subarray(atlas.oldIndex[v]! * stride, atlas.oldIndex[v]! * stride + stride), v * stride);
      return o;
    };
    outPositions = atlas.positions;
    outIndices = atlas.indices;
    outNormals = remapF(normals, 3);
    outJoints = remapU8(skin.joints, 4);
    outWeights = remapU8(skin.weights, 4);
    const dense = remapF(skin.dense, skin.boneCount);
    uvs = atlas.uvs;

    t = performance.now();
    colors = paintMesh({ positions: outPositions, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense }, seed: def.seed, initial: rgb('#ffffff') }, def.paint.shade);
    lap('paint', t);

    t = performance.now();
    const bakeIn = { atlas, normals: outNormals, dense, boneCount: skin.boneCount, sdf: full, body: def.body, skeleton: def.skeleton, seed: def.seed, size: S, log };
    // the painter's cached texture replaces the procedural bake when it was painted on exactly this layout
    layout = layoutHash(atlas.positions, atlas.uvs, atlas.indices);
    const painted = loadPaintedTexture(def.id, layout, log);
    let bakedRgba: Uint8Array | undefined;
    if (painted) {
      texture = painted;
      log(`  using painted texture ${painted.width}x${painted.height} (${(painted.webp.length / 1024).toFixed(0)} KB, layout ${layout})`);
    } else {
      const baked = bakeAlbedo({ ...bakeIn, layers: def.paint.albedo });
      bakedRgba = baked.rgba;
      texture = { webp: encodeWebp(baked.rgba, S, S, def.paint.quality ?? 90), width: S, height: S };
      log(`  baked ${S}x${S} albedo -> ${(texture.webp.length / 1024).toFixed(0)} KB webp (${Math.round(performance.now() - t)}ms)`);
    }
    lap('bake', t);
    if (def.paint.emissive) {
      t = performance.now();
      const eb = bakeAlbedo({ ...bakeIn, layers: [{ name: 'black', apply: (v) => { v.color = [0, 0, 0]; } }, ...def.paint.emissive] });
      emissive = { webp: encodeWebp(eb.rgba, S, S, 88), width: S, height: S };
      log(`  baked emissive ${(emissive.webp.length / 1024).toFixed(0)} KB (${Math.round(performance.now() - t)}ms)`);
    }
    if (process.env.FORGE_DEBUG && bakedRgba) {
      const dir = join(repoRoot(), '.research', 'forge', def.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'albedo.png'), encodePng(bakedRgba, S, S));
    }
  } else {
    t = performance.now();
    colors = paintMesh({ positions, normals, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, [...def.paint.albedo, ...def.paint.shade]);
    lap('paint', t);
    log(`  vertex-color build (texture disabled, ${ms.paint}ms)`);
  }

  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    minX = Math.min(minX, positions[v]!); maxX = Math.max(maxX, positions[v]!);
    minY = Math.min(minY, positions[v + 1]!); maxY = Math.max(maxY, positions[v + 1]!);
    minZ = Math.min(minZ, positions[v + 2]!); maxZ = Math.max(maxZ, positions[v + 2]!);
  }
  const radius = def.radius ?? Math.round(0.5 * Math.sqrt((maxX - minX) * (maxZ - minZ)) * 1.15 * 100) / 100;
  const clips = def.clips.map((c) => sampleClip(def.skeleton, c));
  const palette = dominantColors(paintMesh({ positions, normals, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, def.paint.albedo), 4);
  log(`  height ${maxY.toFixed(3)} m, tris ${outIndices.length / 3}, bones ${def.skeleton.count}`);
  return {
    id: def.id,
    kind: def.kind,
    positions: outPositions,
    normals: outNormals,
    colors,
    indices: outIndices,
    ...(uvs ? { uvs } : {}),
    ...(texture ? { texture } : {}),
    ...(emissive ? { emissive, emissiveFactor: def.emissiveFactor ?? [1, 1, 1] as [number, number, number] } : {}),
    material: def.material ?? { roughness: 0.82, metallic: 0 },
    skin: { skeleton: def.skeleton, joints: outJoints, weights: outWeights },
    clips,
    height: maxY,
    radius,
    sockets: def.sockets,
    palette,
    extras: { ...(def.extras ?? {}), ...(layout ? { layoutHash: layout } : {}), bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
  };
}
