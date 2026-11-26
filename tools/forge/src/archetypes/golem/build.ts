// Golem build pipeline = giant/pipeline.ts `buildCrowd` (regularised decimation) + hard-surface extras:
//   * normal-aware decimation (meshopt `simplifyWithAttributes` with vertex normals as attributes): flat slab faces collapse,
//     bevels / creases / chipped edges keep their vertices, so slabs stay crisp at <= 5k tris;
//   * crease-split face normals (like HardMesh.finish): faces within `crease` degrees share a smooth normal, harder edges get
//     their own vertices, so a slab reads as planes meeting at bevelled edges instead of a lumpy clay shell;
//   * vertex colours / baked texture see the split normals (snow caps, edge wear and AO key off crisp faces).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
import { sampleClip } from '../../core/anim/clip.ts';
import { dominantColors, repoRoot } from '../../core/export/manifest.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { type FocusRegion, compact, ensureSimplifier, orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals } from '../../core/mesh/simplify.ts';
import { type RawMesh, meshSdf } from '../../core/mesh/surfaceNets.ts';
import type { ModelData } from '../../core/model.ts';
import { bakeAlbedo } from '../../core/paint/bake.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { paintMesh, rgb } from '../../core/paint/painter.ts';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import type { HeroDef } from '../humanoid/index.ts';

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export interface HardOpts {
  /** crease angle (degrees): faces closer than this share a smooth normal */
  crease?: number;
  /** normal attribute weight of the decimator (metres of position error per unit of normal change) */
  normalWeight?: number;
}

/** area-weighted vertex normals of an indexed mesh (decimator attribute) */
function vertexNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o]! += nx; n[o + 1]! += ny; n[o + 2]! += nz; }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!) || 1;
    n[v]! /= l; n[v + 1]! /= l; n[v + 2]! /= l;
  }
  return n;
}

/** normal-aware regularised decimation with the same focus warp as core simplify() */
async function simplifyHard(mesh: RawMesh, o: { targetTris: number; focus?: FocusRegion[]; normalWeight: number }): Promise<RawMesh> {
  await ensureSimplifier();
  const nv = mesh.positions.length / 3;
  const warped = new Float32Array(mesh.positions);
  for (const f of o.focus ?? []) {
    for (let v = 0; v < nv; v++) {
      const dx = warped[v * 3]! - f.c[0], dy = warped[v * 3 + 1]! - f.c[1], dz = warped[v * 3 + 2]! - f.c[2];
      const t = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / f.r;
      if (t <= 0) continue;
      const g = 1 + (f.gain - 1) * t * t * (3 - 2 * t);
      warped[v * 3] = f.c[0] + dx * g; warped[v * 3 + 1] = f.c[1] + dy * g; warped[v * 3 + 2] = f.c[2] + dz * g;
    }
  }
  const nrm = vertexNormals(mesh.positions, mesh.indices);
  const target = Math.max(3, Math.floor(o.targetTris) * 3);
  const [out] = MeshoptSimplifier.simplifyWithAttributes(mesh.indices, warped, 3, nrm, 3, [o.normalWeight, o.normalWeight, o.normalWeight], null, target, 1e9, ['ErrorAbsolute', 'Regularize', 'Permissive']);
  return compact({ positions: mesh.positions, indices: out });
}

/**
 * Split vertices along creases. Returns the new index buffer, `vmap` (new vertex -> source vertex) and the per-new-vertex normal.
 * Face adjacency is taken over POSITION-welded vertices so UV-seam duplicates stay smooth.
 */
export function creaseSplit(pos: Float32Array, idx: Uint32Array, creaseDeg: number): { indices: Uint32Array; vmap: Uint32Array; normals: Float32Array } {
  const nt = idx.length / 3;
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const fn = new Float64Array(nt * 3), area = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    area[t] = l * 0.5;
    if (l > 1e-14) { fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l; }
  }
  // weld by position
  const nv = pos.length / 3;
  const groupOf = new Int32Array(nv);
  const keys = new Map<string, number>();
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(pos[v * 3]! * 2e4)},${Math.round(pos[v * 3 + 1]! * 2e4)},${Math.round(pos[v * 3 + 2]! * 2e4)}`;
    let g = keys.get(k);
    if (g === undefined) keys.set(k, (g = keys.size));
    groupOf[v] = g;
  }
  const facesOf: number[][] = Array.from({ length: keys.size }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const g = groupOf[idx[t * 3 + k]!]!;
    const arr = facesOf[g]!;
    if (arr[arr.length - 1] !== t) arr.push(t);
  }
  const outIdx = new Uint32Array(idx.length);
  const vmap: number[] = [];
  const nrm: number[] = [];
  const made = new Map<string, number>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      let sx = 0, sy = 0, sz = 0;
      for (const f of facesOf[groupOf[v]!]!) {
        const d = fn[f * 3]! * fn[t * 3]! + fn[f * 3 + 1]! * fn[t * 3 + 1]! + fn[f * 3 + 2]! * fn[t * 3 + 2]!;
        if (d < cosC) continue;
        sx += fn[f * 3]! * area[f]!; sy += fn[f * 3 + 1]! * area[f]!; sz += fn[f * 3 + 2]! * area[f]!;
      }
      let l = Math.hypot(sx, sy, sz);
      if (l < 1e-12) { sx = fn[t * 3]!; sy = fn[t * 3 + 1]!; sz = fn[t * 3 + 2]!; l = 1; }
      sx /= l; sy /= l; sz /= l;
      const key = `${v}:${Math.round(sx * 500)},${Math.round(sy * 500)},${Math.round(sz * 500)}`;
      let id = made.get(key);
      if (id === undefined) {
        id = vmap.length;
        made.set(key, id);
        vmap.push(v);
        nrm.push(sx, sy, sz);
      }
      outIdx[t * 3 + k] = id;
    }
  }
  return { indices: outIdx, vmap: Uint32Array.from(vmap), normals: Float32Array.from(nrm) };
}

/** HeroDef -> ModelData with the hard-surface pipeline described in the header */
export async function buildHard(def: HeroDef, log: (s: string) => void = () => {}, hard: HardOpts = {}): Promise<ModelData> {
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
  mesh = await simplifyHard(mesh, { targetTris: def.mesh.tris, normalWeight: hard.normalWeight ?? 0.03, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
  lap('simplify', t);
  log(`  simplified: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris (${ms.simplify}ms)`);

  t = performance.now();
  if ((def.mesh.relax ?? 0) > 0) mesh = relax(mesh, full, def.mesh.relax ?? 0, 0.4);
  const positions = projectToSurface(mesh.positions, full, def.mesh.project ?? 2);
  const sdfN = sdfNormals(positions, full, def.mesh.normalStep ?? 0.004);
  const flips = orientToNormals(mesh.indices, positions, sdfN);
  if (flips > 0) log(`  re-oriented ${flips} flipped triangles`);
  lap('relax+normals', t);

  t = performance.now();
  const skin = computeSkinWeights(positions, mesh.indices, def.body, def.skeleton, def.skin);
  lap('skin', t);

  const S = def.paint.size;
  let outPos: Float32Array;
  let outNormals: Float32Array;
  let outIdx: Uint32Array;
  let outJoints: Uint8Array;
  let outWeights: Uint8Array;
  let colors: Float32Array;
  let outUv: Float32Array | undefined;
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
    const nvA = atlas.positions.length / 3;
    log(`  unwrapped: ${nvA} verts (+${nvA - positions.length / 3} seam dupes), atlas ${atlas.width}x${atlas.height} (${ms.unwrap}ms)`);

    // crease split on the atlas mesh
    const split = creaseSplit(atlas.positions, atlas.indices, hard.crease ?? 34);
    const nv2 = split.vmap.length;
    log(`  crease split: ${nvA} -> ${nv2} verts`);
    const remapF = (src: Float32Array, stride: number, viaAtlas: boolean): Float32Array => {
      const o = new Float32Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) {
        const a = split.vmap[v]!;
        const s = viaAtlas ? atlas.oldIndex[a]! : a;
        o.set(src.subarray(s * stride, s * stride + stride), v * stride);
      }
      return o;
    };
    const remapU8 = (src: Uint8Array, stride: number): Uint8Array => {
      const o = new Uint8Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) o.set(src.subarray(atlas.oldIndex[split.vmap[v]!]! * stride, atlas.oldIndex[split.vmap[v]!]! * stride + stride), v * stride);
      return o;
    };
    outPos = remapF(atlas.positions, 3, false);
    outUv = remapF(atlas.uvs, 2, false);
    outNormals = split.normals;
    outIdx = split.indices;
    outJoints = remapU8(skin.joints, 4);
    outWeights = remapU8(skin.weights, 4);
    const dense = remapF(skin.dense, skin.boneCount, true);
    const atlas2 = { ...atlas, positions: outPos, uvs: outUv, indices: outIdx, oldIndex: Uint32Array.from({ length: nv2 }, (_, i) => i) };

    t = performance.now();
    colors = paintMesh({ positions: outPos, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense }, seed: def.seed, initial: rgb('#ffffff') }, def.paint.shade);
    lap('paint', t);

    t = performance.now();
    const bakeIn = { atlas: atlas2, normals: outNormals, dense, boneCount: skin.boneCount, sdf: full, body: def.body, skeleton: def.skeleton, seed: def.seed, size: S, log };
    layout = layoutHash(outPos, outUv, outIdx);
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
    // Texture-disabled vertex-color path: skip xatlas unwrap / cache / texture baking, keep hard-surface crease split.
    const split = creaseSplit(positions, mesh.indices, hard.crease ?? 34);
    const nv2 = split.vmap.length;
    log(`  crease split: ${positions.length / 3} -> ${nv2} verts`);
    const remapF = (src: Float32Array, stride: number): Float32Array => {
      const o = new Float32Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) o.set(src.subarray(split.vmap[v]! * stride, split.vmap[v]! * stride + stride), v * stride);
      return o;
    };
    const remapU8 = (src: Uint8Array, stride: number): Uint8Array => {
      const o = new Uint8Array(nv2 * stride);
      for (let v = 0; v < nv2; v++) o.set(src.subarray(split.vmap[v]! * stride, split.vmap[v]! * stride + stride), v * stride);
      return o;
    };
    outPos = remapF(positions, 3);
    outNormals = split.normals;
    outIdx = split.indices;
    outJoints = remapU8(skin.joints, 4);
    outWeights = remapU8(skin.weights, 4);
    const dense = remapF(skin.dense, skin.boneCount);

    t = performance.now();
    colors = paintMesh({ positions: outPos, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense }, seed: def.seed }, [...def.paint.albedo, ...def.paint.shade]);
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
  const palette = dominantColors(paintMesh({ positions, normals: sdfN, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, def.paint.albedo), 4);
  log(`  height ${maxY.toFixed(3)} m, tris ${outIdx.length / 3}, bones ${def.skeleton.count}`);
  return {
    id: def.id,
    kind: def.kind,
    positions: outPos,
    normals: outNormals,
    colors,
    indices: outIdx,
    ...(outUv ? { uvs: outUv } : {}),
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
