// End-to-end creature pipeline: SDF body -> surface nets -> cleanup -> simplify -> relax -> normals -> skin weights -> paint -> clips.
import { type ClipSpec, sampleClip } from './anim/clip.ts';
import { dominantColors } from './export/manifest.ts';
import { type FocusRegion, orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals, simplify } from './mesh/simplify.ts';
import { meshSdf } from './mesh/surfaceNets.ts';
import type { ModelData, ModelKind } from './model.ts';
import { bakeAlbedo } from './paint/bake.ts';
import { type PaintLayer, paintMesh, rgb } from './paint/painter.ts';
import { encodePng, encodeWebp } from './export/image.ts';
import { layoutHash, loadPaintedTexture } from './paint/cache.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './export/manifest.ts';
import { unwrap } from './mesh/atlas.ts';
import type { Body } from './sdf/body.ts';
import { type SkinOpts, computeSkinWeights } from './skin/weights.ts';
import type { Skeleton } from './skin/skeleton.ts';

export interface MeshSettings {
  /** surface-nets cell size (metres). 0.006-0.01 for crowd creatures */
  voxel: number;
  /** final triangle target */
  tris: number;
  focus?: FocusRegion[];
  /** tangential relax + reproject iterations after simplification */
  relax?: number;
  /** components smaller than this many triangles are deleted */
  minComponentTris?: number;
  /** SDF-gradient normal step (metres): larger = smoother shading */
  normalStep?: number;
  /** extra vertex reprojection iterations after relax */
  project?: number;
}

/**
 * Paint recipe. `albedo` layers colour the surface; `shade` layers (AO, cavity, hemisphere, rim) darken/tint it.
 * Without `texture` both stacks run per vertex into COLOR_0. With `texture` the albedo stack is baked into a UV-mapped
 * WebP (baseColorTexture) and the shade stack goes to COLOR_0 as a multiplier (glTF multiplies the two).
 */
export interface PaintSpec {
  /**
   * Optional emissive layer stack (needs `texture`): baked over the same atlas with black initial colour/background into
   * `ModelData.emissive` (sRGB WebP -> material.emissiveTexture, emissiveFactor [1,1,1]). Layers get the same bone/region/ao access as albedo.
   */
  emissive?: PaintLayer[];
  albedo: PaintLayer[];
  shade?: PaintLayer[];
  texture?: { size: number; quality?: number };
}

export interface CreatureDef {
  id: string;
  kind: Extract<ModelKind, 'creature' | 'boss'>;
  skeleton: Skeleton;
  body: Body;
  paint: PaintSpec;
  clips: ClipSpec[];
  mesh: MeshSettings;
  skin?: SkinOpts;
  sockets: Record<string, string>;
  seed: number | string;
  /** override footprint radius (metres) */
  radius?: number;
  /** PBR overrides (default roughness 0.88, metallic 0) */
  material?: { roughness?: number; metallic?: number };
  /** merged into the GLB scene extras (e.g. authored ground speeds `speed: {walk, run}` in m/s) */
  extras?: Record<string, unknown>;
}

export interface BuildLog {
  rawTris: number;
  tris: number;
  verts: number;
  ms: Record<string, number>;
}

function meshHealth(indices: Uint32Array): string {
  const und = new Map<string, number>();
  const dir = new Map<string, number>();
  let same = 0;
  for (let i = 0; i < indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k]!, b = indices[i + ((k + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      und.set(key, (und.get(key) ?? 0) + 1);
      const dk = `${a}_${b}`;
      const n = (dir.get(dk) ?? 0) + 1;
      dir.set(dk, n);
      if (n > 1) same++;
    }
  let open = 0, bad = 0;
  for (const c of und.values()) { if (c === 1) open++; else if (c > 2) bad++; }
  return `boundary ${open}, nonmanifold ${bad}, same-dir dup ${same}`;
}

export async function buildCreature(def: CreatureDef, log: (s: string) => void = () => {}): Promise<{ model: ModelData; info: BuildLog }> {
  const ms: Record<string, number> = {};
  const lap = (k: string, t0: number): void => {
    ms[k] = Math.round(performance.now() - t0);
  };
  const full = def.body.sdf(false);
  let t = performance.now();
  const bb = full.bounds();
  let mesh = meshSdf(full, { voxel: def.mesh.voxel, bounds: bb });
  lap('mesh', t);
  const rawTris = mesh.indices.length / 3;
  if (process.env.FORGE_DEBUG) log(`  DEBUG raw ${meshHealth(mesh.indices)}`);
  log(`  surface nets: ${mesh.positions.length / 3} verts, ${rawTris} tris (${ms.mesh}ms)`);

  t = performance.now();
  mesh = removeSmallComponents(mesh, def.mesh.minComponentTris ?? 40);
  mesh = await simplify(mesh, { targetTris: def.mesh.tris, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
  lap('simplify', t);
  log(`  simplified: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris (${ms.simplify}ms)`);
  if (process.env.FORGE_DEBUG) log(`  DEBUG simplified ${meshHealth(mesh.indices)}`);

  t = performance.now();
  const maxDim = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
  const maxStep = Math.max(0.15, 0.08 * maxDim); // above any legit projection step, far below a stray
  if ((def.mesh.relax ?? 0) > 0) mesh = relax(mesh, full, def.mesh.relax ?? 0, 0.45, maxStep);
  const positions = projectToSurface(mesh.positions, full, def.mesh.project ?? 2, undefined, maxStep);
  const normals = sdfNormals(positions, full, def.mesh.normalStep ?? 0.014);
  const flips = orientToNormals(mesh.indices, positions, normals);
  if (flips > 0) log(`  re-oriented ${flips} flipped triangles`);
  lap('relax+normals', t);
  {
    // stray-vertex guard: a single vertex thrown across the model shows as long spikes in every pose
    let longest = 0;
    for (let i = 0; i < mesh.indices.length; i++) {
      const a0 = mesh.indices[i]! * 3, b0 = mesh.indices[i % 3 === 2 ? i - 2 : i + 1]! * 3;
      longest = Math.max(longest, Math.hypot(positions[a0]! - positions[b0]!, positions[a0 + 1]! - positions[b0 + 1]!, positions[a0 + 2]! - positions[b0 + 2]!));
    }
    if (longest > 0.3 * maxDim) log(`  WARNING: longest edge ${longest.toFixed(3)} m (> 30% of the ${maxDim.toFixed(2)} m model size): stray vertex? check the SDF gradient`);
    else if (process.env.FORGE_DEBUG) log(`  longest edge ${longest.toFixed(3)} m`);
  }

  t = performance.now();
  const skin = computeSkinWeights(positions, mesh.indices, def.body, def.skeleton, def.skin);
  lap('skin', t);

  t = performance.now();
  let outPositions = positions, outNormals = normals, outIndices = mesh.indices;
  let outJoints = skin.joints, outWeights = skin.weights;
  let colors: Float32Array;
  let uvs: Float32Array | undefined;
  let texture: ModelData['texture'];
  let layout: string | undefined;
  let emissive: ModelData['emissive'];
  const spec = def.paint;
  if (spec.texture) {
    // 1. unwrap (duplicates vertices along seams) and remap every per-vertex array
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a0 = mesh.indices[i]! * 3, b0 = mesh.indices[i + 1]! * 3, c0 = mesh.indices[i + 2]! * 3;
      const ux = positions[b0]! - positions[a0]!, uy = positions[b0 + 1]! - positions[a0 + 1]!, uz = positions[b0 + 2]! - positions[a0 + 2]!;
      const wx = positions[c0]! - positions[a0]!, wy = positions[c0 + 1]! - positions[a0 + 1]!, wz = positions[c0 + 2]! - positions[a0 + 2]!;
      area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    }
    const S = spec.texture.size;
    const tpu = Math.sqrt((0.55 * S * S) / area);
    const atlas = await unwrap(positions, mesh.indices, { texelsPerUnit: tpu });
    lap('unwrap', t);
    if (process.env.FORGE_DEBUG) log(`  DEBUG tris before unwrap ${mesh.indices.length / 3}, after ${atlas.indices.length / 3}`);
    log(`  unwrapped: ${atlas.positions.length / 3} verts (+${atlas.positions.length / 3 - positions.length / 3} seam dupes), atlas ${atlas.width}x${atlas.height} (${ms.unwrap}ms)`);
    const nv2 = atlas.positions.length / 3;
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
    // 2. shade multiplier per vertex
    colors = paintMesh({ positions: outPositions, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense }, seed: def.seed, initial: rgb('#ffffff') }, spec.shade ?? []);
    lap('paint', t);
    // 3. bake albedo (or take the painter's cached texture when it was painted on exactly this layout)
    t = performance.now();
    layout = layoutHash(outPositions, atlas.uvs, outIndices);
    const painted = loadPaintedTexture(def.id, layout, log);
    if (painted) {
      texture = painted;
      lap('bake', t);
      log(`  using painted texture ${painted.width}x${painted.height} (${(painted.webp.length / 1024).toFixed(0)} KB, layout ${layout})`);
    } else {
    const baked = bakeAlbedo({ atlas, normals: outNormals, dense, boneCount: skin.boneCount, sdf: full, body: def.body, skeleton: def.skeleton, layers: spec.albedo, seed: def.seed, size: S, log });
    if (process.env.FORGE_DEBUG) {
      const dir = join(repoRoot(), '.research', 'forge', def.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'albedo.png'), encodePng(baked.rgba, S, S));
    }
    texture = { webp: encodeWebp(baked.rgba, S, S, spec.texture.quality ?? 90), width: S, height: S };
    lap('bake', t);
    log(`  baked ${S}x${S} albedo -> ${(texture.webp.length / 1024).toFixed(0)} KB webp (${ms.bake}ms)`);
    }
    if (spec.emissive?.length) {
      t = performance.now();
      const em = bakeAlbedo({ atlas, normals: outNormals, dense, boneCount: skin.boneCount, sdf: full, body: def.body, skeleton: def.skeleton, layers: spec.emissive, seed: def.seed, size: S, initial: [0, 0, 0], background: [0, 0, 0] });
      emissive = { webp: encodeWebp(em.rgba, S, S, 85), width: S, height: S };
      lap('emissive', t);
      log(`  baked emissive ${S}x${S} -> ${(emissive.webp.length / 1024).toFixed(0)} KB webp (${ms.emissive}ms)`);
    }
  } else {
    colors = paintMesh({ positions, normals, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, [...spec.albedo, ...(spec.shade ?? [])]);
    lap('paint', t);
  }

  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    minX = Math.min(minX, positions[v]!); maxX = Math.max(maxX, positions[v]!);
    minY = Math.min(minY, positions[v + 1]!); maxY = Math.max(maxY, positions[v + 1]!);
    minZ = Math.min(minZ, positions[v + 2]!); maxZ = Math.max(maxZ, positions[v + 2]!);
  }
  const radius = def.radius ?? Math.round(0.5 * Math.sqrt((maxX - minX) * (maxZ - minZ)) * 1.15 * 100) / 100;
  const clips = def.clips.map((c) => sampleClip(def.skeleton, c));

  const model: ModelData = {
    id: def.id,
    kind: def.kind,
    positions: outPositions,
    normals: outNormals,
    colors,
    indices: outIndices,
    ...(uvs ? { uvs } : {}),
    ...(texture ? { texture } : {}),
    ...(emissive ? { emissive } : {}),
    ...(def.material ? { material: def.material } : {}),
    skin: { skeleton: def.skeleton, joints: outJoints, weights: outWeights },
    clips,
    height: maxY,
    radius,
    sockets: def.sockets,
    palette: dominantColors(spec.texture ? paintMesh({ positions, normals, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, [...spec.albedo]) : colors, 4),
    extras: { ...(def.extras ?? {}), ...(layout ? { layoutHash: layout } : {}), bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
  };
  return { model, info: { rawTris, tris: outIndices.length / 3, verts: outPositions.length / 3, ms } };
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
