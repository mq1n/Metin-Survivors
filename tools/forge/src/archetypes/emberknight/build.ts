// Mesh/bake pipeline for the ember family: identical to giant/pipeline.ts `buildCrowd` (regularised decimation, atlas, painted-texture hook, emissive map)
// except that parts matched by a MeshGroup (the baked sword, horns / crest blades, body spikes ...) are meshed on their own at a finer voxel
// with their own triangle budget and then merged. One decimation pass over the whole creature collapses a 2 cm thick blade long before it spends
// triangles on it (quadric error of the thin rim < error of the body), so thin props need their own budget to survive.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleClip } from '../../core/anim/clip.ts';
import { dominantColors, repoRoot } from '../../core/export/manifest.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { type FocusRegion, compact, orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals } from '../../core/mesh/simplify.ts';
import { type RawMesh, meshSdf } from '../../core/mesh/surfaceNets.ts';
import type { ModelData } from '../../core/model.ts';
import { bakeAlbedo } from '../../core/paint/bake.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { paintMesh, rgb } from '../../core/paint/painter.ts';
import { Body } from '../../core/sdf/body.ts';
import { SmoothUnion, type UnionChild } from '../../core/sdf/ops.ts';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import { simplifyReg } from '../giant/pipeline.ts';
import type { HeroDef } from '../humanoid/index.ts';

export interface MeshGroup {
  /** parts whose name matches are meshed separately */
  match: RegExp;
  voxel: number;
  tris: number;
  focus?: FocusRegion[];
  /** drop group triangles buried deeper than this inside the main body (m); default 0.005 */
  buried?: number;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

function merge(meshes: RawMesh[]): RawMesh {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + vo / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

export async function buildEmberCrowd(def: HeroDef, groups: MeshGroup[], log: (s: string) => void = () => {}): Promise<ModelData> {
  const ms: Record<string, number> = {};
  const lap = (k: string, t0: number): void => {
    ms[k] = Math.round(performance.now() - t0);
  };
  const full = def.body.sdf(false);
  // main body = every part that belongs to no group
  const inGroup = (name: string): number => groups.findIndex((g) => g.match.test(name));
  const mainBody = new Body();
  mainBody.blend = def.body.blend;
  mainBody.parts = def.body.parts.filter((p) => inGroup(p.name) < 0);
  const mainSdf = mainBody.sdf(false);
  let t = performance.now();
  let mesh = meshSdf(mainSdf, { voxel: def.mesh.voxel, bounds: mainSdf.bounds() });
  lap('mesh', t);
  log(`  surface nets: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris (${ms.mesh}ms)`);

  t = performance.now();
  mesh = removeSmallComponents(mesh, def.mesh.minComponentTris ?? 60);
  mesh = await simplifyReg(mesh, { targetTris: def.mesh.tris, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
  const parts: RawMesh[] = [mesh];
  const sizes: string[] = [`body ${mesh.indices.length / 3}`];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const gp = def.body.parts.filter((p) => inGroup(p.name) === gi && (p.stage === 'base' || p.stage === 'late'));
    if (gp.length === 0) continue;
    const children: UnionChild[] = gp.map((p) => ({ node: p.sdf, w: p.w }));
    const gs = new SmoothUnion(children);
    let gm = meshSdf(gs, { voxel: g.voxel, bounds: gs.bounds() });
    // drop what is buried inside the main body (the grip inside the fist)
    const keep: number[] = [];
    const buried = -(g.buried ?? 0.005);
    for (let i = 0; i < gm.indices.length; i += 3) {
      const a = gm.indices[i]! * 3, b = gm.indices[i + 1]! * 3, c = gm.indices[i + 2]! * 3;
      const cx = (gm.positions[a]! + gm.positions[b]! + gm.positions[c]!) / 3, cy = (gm.positions[a + 1]! + gm.positions[b + 1]! + gm.positions[c + 1]!) / 3, cz = (gm.positions[a + 2]! + gm.positions[b + 2]! + gm.positions[c + 2]!) / 3;
      if (mainSdf.d(cx, cy, cz) < buried) continue;
      keep.push(gm.indices[i]!, gm.indices[i + 1]!, gm.indices[i + 2]!);
    }
    gm = removeSmallComponents(compact({ positions: gm.positions, indices: Uint32Array.from(keep) }), 40);
    gm = await simplifyReg(gm, { targetTris: g.tris, ...(g.focus ? { focus: g.focus } : {}) });
    parts.push(gm);
    sizes.push(`${g.match.source.slice(0, 18)} ${gm.indices.length / 3}`);
  }
  mesh = merge(parts);
  lap('simplify', t);
  log(`  simplified: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris [${sizes.join(', ')}] (${ms.simplify}ms)`);

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

  t = performance.now();
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a0 = mesh.indices[i]! * 3, b0 = mesh.indices[i + 1]! * 3, c0 = mesh.indices[i + 2]! * 3;
    const ux = positions[b0]! - positions[a0]!, uy = positions[b0 + 1]! - positions[a0 + 1]!, uz = positions[b0 + 2]! - positions[a0 + 2]!;
    const wx = positions[c0]! - positions[a0]!, wy = positions[c0 + 1]! - positions[a0 + 1]!, wz = positions[c0 + 2]! - positions[a0 + 2]!;
    area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  const S = def.paint.size;
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
  const outNormals = remapF(normals, 3);
  const outJoints = remapU8(skin.joints, 4);
  const outWeights = remapU8(skin.weights, 4);
  const dense = remapF(skin.dense, skin.boneCount);

  t = performance.now();
  const colors = paintMesh({ positions: atlas.positions, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense }, seed: def.seed, initial: rgb('#ffffff') }, def.paint.shade);
  lap('paint', t);

  t = performance.now();
  const bakeIn = { atlas, normals: outNormals, dense, boneCount: skin.boneCount, sdf: full, body: def.body, skeleton: def.skeleton, seed: def.seed, size: S, log };
  const layout = layoutHash(atlas.positions, atlas.uvs, atlas.indices);
  const painted = loadPaintedTexture(def.id, layout, log);
  let texture: ModelData['texture'];
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
  let emissive: ModelData['emissive'];
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

  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    minX = Math.min(minX, positions[v]!); maxX = Math.max(maxX, positions[v]!);
    minY = Math.min(minY, positions[v + 1]!); maxY = Math.max(maxY, positions[v + 1]!);
    minZ = Math.min(minZ, positions[v + 2]!); maxZ = Math.max(maxZ, positions[v + 2]!);
  }
  const radius = def.radius ?? Math.round(0.5 * Math.sqrt((maxX - minX) * (maxZ - minZ)) * 1.15 * 100) / 100;
  const clips = def.clips.map((c) => sampleClip(def.skeleton, c));
  const palette = dominantColors(paintMesh({ positions, normals, sdf: full, body: def.body, skeleton: def.skeleton, skin, seed: def.seed }, def.paint.albedo), 4);
  log(`  height ${maxY.toFixed(3)} m, tris ${atlas.indices.length / 3}, bones ${def.skeleton.count}`);
  return {
    id: def.id,
    kind: def.kind,
    positions: atlas.positions,
    normals: outNormals,
    colors,
    indices: atlas.indices,
    uvs: atlas.uvs,
    texture,
    ...(emissive ? { emissive, emissiveFactor: def.emissiveFactor ?? [1, 1, 1] as [number, number, number] } : {}),
    material: def.material ?? { roughness: 0.82, metallic: 0 },
    skin: { skeleton: def.skeleton, joints: outJoints, weights: outWeights },
    clips,
    height: maxY,
    radius,
    sockets: def.sockets,
    palette,
    extras: { ...(def.extras ?? {}), layoutHash: layout, bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
  };
}
