// Crowd build with AUTHORED triangles appended to the SDF mesh. A copy of orc/build.ts `buildCrowd` (same stages, same regularised
// decimation) with one change: after the body mesh is decimated / relaxed / normalled / skinned, the authored meshes (talisman strips,
// see conjurer_strips.ts) are concatenated with explicit skin weights, so UV unwrap, the procedural bake and the painted-texture layout
// hash all see ONE mesh. The authored vertices are never meshed, decimated or projected by the SDF, which is the point: thin paper slips
// stay crisp. Paint for them comes from layers keyed on the strip frame (no SDF regions needed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleClip } from '../../core/anim/clip.ts';
import { dominantColors, repoRoot } from '../../core/export/manifest.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { orientToNormals, projectToSurface, relax, removeSmallComponents, sdfNormals } from '../../core/mesh/simplify.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { meshSdf } from '../../core/mesh/surfaceNets.ts';
import type { Aabb } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { bakeAlbedo } from '../../core/paint/bake.ts';
import { type PaintLayer, paintMesh, rgb } from '../../core/paint/painter.ts';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import type { HeroDef } from '../humanoid/index.ts';
import { simplifyReg } from '../orc/mesh.ts';
import type { Authored } from './conjurer_strips.ts';

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** unsigned distance to a set of triangles (flat arrays: 9 floats per triangle). Used as a bake-time stand-in for the authored sheets. */
export class TriSdf extends Sdf {
  private lo: Float64Array;
  private hi: Float64Array;
  constructor(private tri: Float64Array) {
    super();
    const n = tri.length / 9;
    this.lo = new Float64Array(n * 3);
    this.hi = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) {
      for (let a = 0; a < 3; a++) {
        const x = tri[t * 9 + a]!, y = tri[t * 9 + 3 + a]!, z = tri[t * 9 + 6 + a]!;
        this.lo[t * 3 + a] = Math.min(x, y, z);
        this.hi[t * 3 + a] = Math.max(x, y, z);
      }
    }
  }
  d(x: number, y: number, z: number): number {
    const T = this.tri;
    let best = Infinity;
    for (let t = 0; t < T.length; t += 9) {
      const ax = T[t]!, ay = T[t + 1]!, az = T[t + 2]!;
      const abx = T[t + 3]! - ax, aby = T[t + 4]! - ay, abz = T[t + 5]! - az;
      const acx = T[t + 6]! - ax, acy = T[t + 7]! - ay, acz = T[t + 8]! - az;
      const apx = x - ax, apy = y - ay, apz = z - az;
      const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
      let qx: number, qy: number, qz: number;
      if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
        const bpx = x - T[t + 3]!, bpy = y - T[t + 4]!, bpz = z - T[t + 5]!;
        const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) { qx = T[t + 3]!; qy = T[t + 4]!; qz = T[t + 5]!; } else {
          const vc = d1 * d4 - d3 * d2;
          if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const v = d1 / (d1 - d3);
            qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
          } else {
            const cpx = x - T[t + 6]!, cpy = y - T[t + 7]!, cpz = z - T[t + 8]!;
            const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
            if (d6 >= 0 && d5 <= d6) { qx = T[t + 6]!; qy = T[t + 7]!; qz = T[t + 8]!; } else {
              const vb = d5 * d2 - d1 * d6;
              if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                const w = d2 / (d2 - d6);
                qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
              } else {
                const va = d3 * d6 - d5 * d4;
                if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                  const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
                  qx = T[t + 3]! + (T[t + 6]! - T[t + 3]!) * w; qy = T[t + 4]! + (T[t + 7]! - T[t + 4]!) * w; qz = T[t + 5]! + (T[t + 8]! - T[t + 5]!) * w;
                } else {
                  const den = 1 / (va + vb + vc);
                  const v = vb * den, w = vc * den;
                  qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
                }
              }
            }
          }
        }
      }
      const dd = (x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz);
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  }
  protected computeBounds(): Aabb {
    const n = this.tri.length / 9;
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < n; t++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, this.lo[t * 3 + a]!); max[a] = Math.max(max[a]!, this.hi[t * 3 + a]!); }
    return { min, max };
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const keep: number[] = [];
    const n = this.tri.length / 9;
    for (let t = 0; t < n; t++) {
      if (this.hi[t * 3]! < cx - r || this.lo[t * 3]! > cx + r || this.hi[t * 3 + 1]! < cy - r || this.lo[t * 3 + 1]! > cy + r || this.hi[t * 3 + 2]! < cz - r || this.lo[t * 3 + 2]! > cz + r) continue;
      for (let k = 0; k < 9; k++) keep.push(this.tri[t * 9 + k]!);
    }
    return keep.length === this.tri.length ? this : new TriSdf(Float64Array.from(keep));
  }
}

/** min(a, b): the surface of either (the bake projects texels onto the nearest of body and sheets) */
class MinSdf extends Sdf {
  constructor(private a: Sdf, private b: Sdf) {
    super();
    this.lip = Math.max(a.lip, b.lip);
  }
  d(x: number, y: number, z: number): number {
    return Math.min(this.a.d(x, y, z), this.b.d(x, y, z));
  }
  protected computeBounds(): Aabb {
    const p = this.a.bounds(), q = this.b.bounds();
    return { min: [Math.min(p.min[0], q.min[0]), Math.min(p.min[1], q.min[1]), Math.min(p.min[2], q.min[2])], max: [Math.max(p.max[0], q.max[0]), Math.max(p.max[1], q.max[1]), Math.max(p.max[2], q.max[2])] };
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    return new MinSdf(this.a.restrict(cx, cy, cz, r), this.b.restrict(cx, cy, cz, r));
  }
}

/** `boost`: texel-density multiplier of the authored meshes against the body (default 1.5) */
export interface AuthoredPaint {
  albedo: PaintLayer[];
  emissive?: PaintLayer[];
}

/**
 * `paint` receives, per authored group (`Authored.name`), a distance function to that group's triangles and returns extra paint layers
 * (appended after the body stack), so authored sheets can be coloured without SDF regions.
 */
export async function buildCrowdAuthored(
  def: HeroDef,
  authored: Authored[],
  log: (s: string) => void = () => {},
  boost = 1.5,
  paint?: (groups: Map<string, (p: [number, number, number]) => number>) => AuthoredPaint,
): Promise<ModelData> {
  const full = def.body.sdf(false);
  let mesh = meshSdf(full, { voxel: def.mesh.voxel, bounds: full.bounds() });
  log(`  surface nets: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris`);
  mesh = removeSmallComponents(mesh, def.mesh.minComponentTris ?? 60);
  mesh = await simplifyReg(mesh, { targetTris: def.mesh.tris, ...(def.mesh.focus ? { focus: def.mesh.focus } : {}) });
  log(`  simplified: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris`);
  if ((def.mesh.relax ?? 0) > 0) mesh = relax(mesh, full, def.mesh.relax ?? 0, 0.4);
  const bodyPos = projectToSurface(mesh.positions, full, def.mesh.project ?? 2);
  const bodyNrm = sdfNormals(bodyPos, full, def.mesh.normalStep ?? 0.006);
  const flips = orientToNormals(mesh.indices, bodyPos, bodyNrm);
  if (flips > 0) log(`  re-oriented ${flips} flipped triangles`);
  const bodySkin = computeSkinWeights(bodyPos, mesh.indices, def.body, def.skeleton, def.skin);

  // ---- append the authored meshes
  const nb = bodyPos.length / 3;
  const na = authored.reduce((s, m) => s + m.positions.length / 3, 0);
  const positions = new Float32Array((nb + na) * 3);
  const normals = new Float32Array((nb + na) * 3);
  const indices = new Uint32Array(mesh.indices.length + authored.reduce((s, m) => s + m.indices.length, 0));
  positions.set(bodyPos);
  normals.set(bodyNrm);
  indices.set(mesh.indices);
  const boneCount = bodySkin.boneCount;
  const joints = new Uint8Array((nb + na) * 4);
  const weights = new Uint8Array((nb + na) * 4);
  const dense = new Float32Array((nb + na) * boneCount);
  joints.set(bodySkin.joints);
  weights.set(bodySkin.weights);
  dense.set(bodySkin.dense);
  let vo = nb, io = mesh.indices.length;
  for (const m of authored) {
    const n = m.positions.length / 3;
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + vo;
    for (let v = 0; v < n; v++) {
      const infl = [...m.skin[v]!].sort((a, b) => b.w - a.w).slice(0, 4);
      const sum = infl.reduce((s, x) => s + x.w, 0) || 1;
      const q = infl.map((x) => Math.floor((x.w / sum) * 255));
      let rem = 255 - q.reduce((a, b) => a + b, 0);
      for (let k = 0; rem > 0; k = (k + 1) % q.length, rem--) q[k]! += 1;
      infl.forEach((x, k) => {
        const bi = def.skeleton.idx(x.bone);
        joints[(vo + v) * 4 + k] = bi;
        weights[(vo + v) * 4 + k] = q[k]!;
        dense[(vo + v) * boneCount + bi] = q[k]! / 255;
      });
    }
    vo += n;
    io += m.indices.length;
  }
  const skin = { joints, weights, dense, boneCount };
  if (paint) {
    const groups = new Map<string, (p: [number, number, number]) => number>();
    let ib = mesh.indices.length;
    for (const m of authored) {
      if (m.name) {
        const flat: number[] = [];
        for (let k = 0; k < m.indices.length; k++) {
          const v = indices[ib + k]! * 3;
          flat.push(positions[v]!, positions[v + 1]!, positions[v + 2]!);
        }
        const tri = new TriSdf(Float64Array.from(flat));
        groups.set(m.name, (p) => tri.d(p[0], p[1], p[2]));
      }
      ib += m.indices.length;
    }
    const extra = paint(groups);
    def.paint.albedo = [...def.paint.albedo, ...extra.albedo];
    if (extra.emissive) def.paint.emissive = [...(def.paint.emissive ?? []), ...extra.emissive];
  }

  // ---- UV unwrap (body + authored together)
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a0 = indices[i]! * 3, b0 = indices[i + 1]! * 3, c0 = indices[i + 2]! * 3;
    const ux = positions[b0]! - positions[a0]!, uy = positions[b0 + 1]! - positions[a0 + 1]!, uz = positions[b0 + 2]! - positions[a0 + 2]!;
    const wx = positions[c0]! - positions[a0]!, wy = positions[c0 + 1]! - positions[a0 + 1]!, wz = positions[c0 + 2]! - positions[a0 + 2]!;
    area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  const S = def.paint.size;
  const tpu = Math.sqrt((0.55 * S * S) / area);
  // the small authored slips get a denser UV share (glyphs stay crisp): unwrap them enlarged, then restore the true positions
  const posU = Float32Array.from(positions);
  for (let v = nb * 3; v < posU.length; v++) posU[v] = posU[v]! * boost;
  const atlas0 = await unwrap(posU, indices, { texelsPerUnit: tpu });
  const nv2 = atlas0.positions.length / 3;
  log(`  unwrapped: ${nv2} verts (+${nv2 - positions.length / 3} seam dupes), atlas ${atlas0.width}x${atlas0.height}`);
  const remapF = (src: Float32Array, stride: number): Float32Array => {
    const o = new Float32Array(nv2 * stride);
    for (let v = 0; v < nv2; v++) o.set(src.subarray(atlas0.oldIndex[v]! * stride, atlas0.oldIndex[v]! * stride + stride), v * stride);
    return o;
  };
  const atlas = { ...atlas0, positions: remapF(positions, 3) };
  const remapU8 = (src: Uint8Array, stride: number): Uint8Array => {
    const o = new Uint8Array(nv2 * stride);
    for (let v = 0; v < nv2; v++) o.set(src.subarray(atlas0.oldIndex[v]! * stride, atlas0.oldIndex[v]! * stride + stride), v * stride);
    return o;
  };
  const outNormals = remapF(normals, 3);
  const outJoints = remapU8(joints, 4);
  const outWeights = remapU8(weights, 4);
  const denseU = remapF(dense, boneCount);

  const colors = paintMesh({ positions: atlas.positions, normals: outNormals, sdf: full, body: def.body, skeleton: def.skeleton, skin: { ...skin, dense: denseU }, seed: def.seed, initial: rgb('#ffffff') }, def.paint.shade);

  // the bake pulls every texel onto the SDF surface: give it the authored sheets too, or their texels land on the body
  const triFlat: number[] = [];
  for (let i = mesh.indices.length; i < indices.length; i++) {
    const v = indices[i]! * 3;
    triFlat.push(positions[v]!, positions[v + 1]!, positions[v + 2]!);
  }
  const bakeSdf: Sdf = triFlat.length ? new MinSdf(full, new TriSdf(Float64Array.from(triFlat))) : full;
  const bakeIn = { atlas, normals: outNormals, dense: denseU, boneCount, sdf: bakeSdf, body: def.body, skeleton: def.skeleton, seed: def.seed, size: S, log };
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
    log(`  baked ${S}x${S} albedo -> ${(texture.webp.length / 1024).toFixed(0)} KB webp`);
  }
  let emissive: ModelData['emissive'];
  // a painted albedo carries its own (AI) glyphs, so the strips' procedural glyph glow would no longer line up with it: only the orb glows then
  const emLayers = painted ? (def.paint.emissive ?? []).filter((l) => l.name !== 'talismanGlow') : def.paint.emissive;
  if (emLayers && emLayers.length > 0) {
    const eb = bakeAlbedo({ ...bakeIn, layers: [{ name: 'black', apply: (v) => { v.color = [0, 0, 0]; } }, ...emLayers] });
    emissive = { webp: encodeWebp(eb.rgba, S, S, 88), width: S, height: S };
    log(`  baked emissive ${(emissive.webp.length / 1024).toFixed(0)} KB`);
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
  log(`  height ${maxY.toFixed(3)} m, tris ${atlas.indices.length / 3} (authored ${indices.length / 3 - mesh.indices.length / 3}), bones ${def.skeleton.count}`);
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
