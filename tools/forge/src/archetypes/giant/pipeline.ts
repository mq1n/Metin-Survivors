// Giant / crowd build pipeline for humanoid-skeleton models (stable copy of the Orc agent's crowd pipeline + lite skeleton).
//
// Why not `buildHumanoid` / `buildHero` for crowd budgets: the core `simplify()` runs meshopt with ErrorAbsolute only. On smooth SDF
// bodies (cylindrical limbs, flat torso) the quadric error of axial collapses is ~0, so at <= 5k tris it leaves 1 m sliver triangles
// (legs turn into cones, bodies "shred" the moment a clip plays) and surface-net non-manifold vertices stay locked. `Regularize` keeps
// triangles well shaped and `Permissive` lets locked vertices collapse (measured by Orcs: longest edge 1.58 m -> 0.13 m, slivers 1126 -> 42).
//
//   buildGiant({ hp, lite })    humanoidDef(hp) -> optional crowd skeleton (finger/thumb bones dropped: -4 joints) -> buildCrowd(def)
//   buildCrowd(def)             HeroDef -> ModelData with the regularised decimation (use for custom pipelines such as golems)
//   reduceSkeleton / remapClips for custom pipelines that assemble their own HeroDef
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
import { type ClipSpec, PoseCtx, sampleClip } from '../../core/anim/clip.ts';
import { dominantColors, repoRoot } from '../../core/export/manifest.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { type FocusRegion, compact, ensureSimplifier, orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals } from '../../core/mesh/simplify.ts';
import { type RawMesh, meshSdf } from '../../core/mesh/surfaceNets.ts';
import type { ModelData } from '../../core/model.ts';
import { bakeAlbedo } from '../../core/paint/bake.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { paintMesh, rgb } from '../../core/paint/painter.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { Skeleton } from '../../core/skin/skeleton.ts';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import { type HeroDef, type HumanoidParams, humanoidDef } from '../humanoid/index.ts';

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** meshopt decimation with Regularize + Permissive and the same focus warp as core simplify() */
export async function simplifyReg(mesh: RawMesh, opts: { targetTris: number; focus?: FocusRegion[] }): Promise<RawMesh> {
  await ensureSimplifier();
  const nv = mesh.positions.length / 3;
  const warped = new Float32Array(mesh.positions);
  for (const f of opts.focus ?? []) {
    for (let v = 0; v < nv; v++) {
      const dx = warped[v * 3]! - f.c[0], dy = warped[v * 3 + 1]! - f.c[1], dz = warped[v * 3 + 2]! - f.c[2];
      const t = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / f.r;
      if (t <= 0) continue;
      const g = 1 + (f.gain - 1) * t * t * (3 - 2 * t);
      warped[v * 3] = f.c[0] + dx * g; warped[v * 3 + 1] = f.c[1] + dy * g; warped[v * 3 + 2] = f.c[2] + dz * g;
    }
  }
  const target = Math.max(3, Math.floor(opts.targetTris) * 3);
  const [out] = MeshoptSimplifier.simplify(mesh.indices, warped, 3, target, 1e9, ['ErrorAbsolute', 'Regularize', 'Permissive']);
  return compact({ positions: mesh.positions, indices: out });
}

/** HeroDef -> ModelData; identical to humanoid/build.ts except for the regularised decimation */
export async function buildCrowd(def: HeroDef, log: (s: string) => void = () => {}): Promise<ModelData> {
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
  mesh = await simplifyReg(mesh, { targetTris: def.mesh.tris, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
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

// ------------------------------------------------------------------------------------------------ crowd skeleton

/** finger / thumb bones: their geometry follows the wrist in the crowd skeleton (-4 joints) */
export const LITE_DROP = ['thumb_l', 'fingers_l', 'thumb_r', 'fingers_r'];

/** copy of `full` without the `drop` bones (order preserved, so parents still precede children) */
export function reduceSkeleton(full: Skeleton, drop: readonly string[]): Skeleton {
  const gone = new Set(drop);
  const parentOf = (name: string): string | null => {
    let p = full.bones[full.idx(name)]!.parent;
    while (p && gone.has(p)) p = full.bones[full.idx(p)]!.parent;
    return p;
  };
  return new Skeleton(full.bones.filter((b) => !gone.has(b.name)).map((b) => ({ ...b, parent: parentOf(b.name) })));
}

/** clips authored on the full skeleton, replayed onto the reduced one (tracks of dropped bones vanish) */
export function remapClips(clips: ClipSpec[], full: Skeleton, reduced: Skeleton): ClipSpec[] {
  const map = reduced.names.map((n) => full.idx(n));
  return clips.map((spec) => ({
    ...spec,
    pose: (c: PoseCtx): void => {
      const fc = new PoseCtx(full, c.t, c.u, c.duration);
      spec.pose(fc);
      for (let i = 0; i < map.length; i++) {
        const j = map[i]!;
        c.pose.rot[i] = fc.pose.rot[j]!;
        c.pose.pos[i] = [...fc.pose.pos[j]!];
      }
      if (fc.pose.scale) {
        c.pose.scale = reduced.bones.map((_, i) => [...fc.pose.scale![map[i]!]!] as [number, number, number]);
      }
    },
  }));
}

export interface GiantParams {
  hp: HumanoidParams;
  /** crowd skeleton: drop the finger / thumb bones (26 base joints instead of 30; leaves 6 for chains) */
  lite?: boolean;
}

export async function buildGiant(p: GiantParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const parts = humanoidDef(p.hp, opts);
  const def = parts.def;
  if (p.lite) {
    const full = parts.skeleton;
    const drop = LITE_DROP.filter((n) => full.has(n));
    const reduced = reduceSkeleton(full, drop);
    for (const part of parts.ctx.body.parts) {
      if (drop.includes(part.bone)) part.bone = `wrist_${part.bone.endsWith('_l') ? 'l' : 'r'}`;
    }
    def.skeleton = reduced;
    def.clips = remapClips(def.clips, full, reduced);
  }
  return buildCrowd(def, log);
}
