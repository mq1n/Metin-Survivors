// Mesh post-processing: component cleanup, meshoptimizer simplification with a "detail focus" warp, relaxation.
import { MeshoptSimplifier } from 'meshoptimizer';
import type { Vec3 } from '../math.ts';
import type { Sdf } from '../sdf/node.ts';
import type { RawMesh } from './surfaceNets.ts';

export interface FocusRegion {
  /** centre of the region that deserves more triangles (e.g. the head) */
  c: Vec3;
  /** radius of full effect */
  r: number;
  /** triangle-density multiplier at the centre (~1.5-3) */
  gain: number;
}

export interface SimplifyOpts {
  targetTris: number;
  focus?: FocusRegion[];
  /** absolute error cap in metres (simplification stops when exceeded); default large so the tri target wins */
  maxError?: number;
}

let simplifierReady: Promise<void> | null = null;
export async function ensureSimplifier(): Promise<void> {
  simplifierReady ??= MeshoptSimplifier.ready;
  await simplifierReady;
}

/** Drop connected components whose triangle count is below `minTris` (floaters from noise/thin features). */
export function removeSmallComponents(mesh: RawMesh, minTris: number): RawMesh {
  const nv = mesh.positions.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(idx[i]!), b = find(idx[i + 1]!), c = find(idx[i + 2]!);
    if (a !== b) parent[b] = a;
    const a2 = find(a);
    if (a2 !== c) parent[c] = a2;
  }
  const count = new Map<number, number>();
  for (let i = 0; i < idx.length; i += 3) {
    const r = find(idx[i]!);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if ((count.get(find(idx[i]!)) ?? 0) >= minTris) keep.push(idx[i]!, idx[i + 1]!, idx[i + 2]!);
  }
  return compact({ positions: mesh.positions, indices: Uint32Array.from(keep) });
}

/** Re-index so only referenced vertices remain. */
export function compact(mesh: RawMesh): RawMesh {
  const nv = mesh.positions.length / 3;
  const map = new Int32Array(nv).fill(-1);
  let n = 0;
  const idx = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i]!;
    if (map[v]! < 0) map[v] = n++;
    idx[i] = map[v]!;
  }
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < nv; v++) {
    const m = map[v]!;
    if (m >= 0) pos.set(mesh.positions.subarray(v * 3, v * 3 + 3), m * 3);
  }
  return { positions: pos, indices: idx };
}

/**
 * Simplify to ~targetTris. Collapse costs are measured in a *warped* copy of the positions in which focus regions are
 * magnified, so those regions keep proportionally more triangles; the output keeps the true positions.
 */
export async function simplify(mesh: RawMesh, opts: SimplifyOpts): Promise<RawMesh> {
  await ensureSimplifier();
  const nv = mesh.positions.length / 3;
  const warped = new Float32Array(mesh.positions);
  // radial magnification about each focus centre: p' = c + (p - c) * g(|p - c|), g falls smoothly from `gain` to 1 at r
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
  const [out] = MeshoptSimplifier.simplify(mesh.indices, warped, 3, target, opts.maxError ?? 1e9, ['ErrorAbsolute']);
  return compact({ positions: mesh.positions, indices: out });
}

/** edge adjacency lists */
export function adjacency(nv: number, indices: Uint32Array): number[][] {
  const adj: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    adj[a]!.add(b).add(c);
    adj[b]!.add(a).add(c);
    adj[c]!.add(a).add(b);
  }
  return adj.map((s) => [...s]);
}

/**
 * Tangential relaxation + reprojection onto the SDF: evens out triangle quality after simplification without
 * shrinking the shape. `sdfAt` should be the smooth (un-displaced) field.
 */
export function relax(mesh: RawMesh, sdf: Sdf, iterations: number, strength = 0.5, maxStep = DEFAULT_MAX_STEP): RawMesh {
  const nv = mesh.positions.length / 3;
  const adj = adjacency(nv, mesh.indices);
  let pos = Float32Array.from(mesh.positions);
  const h = 0.004;
  for (let it = 0; it < iterations; it++) {
    const next = Float32Array.from(pos);
    for (let v = 0; v < nv; v++) {
      const nbrs = adj[v]!;
      if (nbrs.length === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const u of nbrs) {
        ax += pos[u * 3]!; ay += pos[u * 3 + 1]!; az += pos[u * 3 + 2]!;
      }
      ax /= nbrs.length; ay /= nbrs.length; az /= nbrs.length;
      const px = pos[v * 3]!, py = pos[v * 3 + 1]!, pz = pos[v * 3 + 2]!;
      let qx = px + (ax - px) * strength, qy = py + (ay - py) * strength, qz = pz + (az - pz) * strength;
      for (let k = 0; k < 2; k++) {
        const d = sdf.d(qx, qy, qz);
        const gx = sdf.d(qx + h, qy, qz) - sdf.d(qx - h, qy, qz);
        const gy = sdf.d(qx, qy + h, qz) - sdf.d(qx, qy - h, qz);
        const gz = sdf.d(qx, qy, qz + h) - sdf.d(qx, qy, qz - h);
        const gl = gx * gx + gy * gy + gz * gz;
        if (gl < 1e-12) break;
        const s = newtonScale(d, h, gl, maxStep);
        qx -= gx * s; qy -= gy * s; qz -= gz * s;
      }
      next[v * 3] = qx; next[v * 3 + 1] = qy; next[v * 3 + 2] = qz;
    }
    pos = next;
  }
  return { positions: pos, indices: mesh.indices };
}

/** A Newton step longer than this (m) is treated as degenerate and skipped (callers scale it with the model size). */
export const DEFAULT_MAX_STEP = 0.15;

/**
 * Scale for the Newton step `x -= g * s`, with `g` the central-difference gradient times 2h (`gl` = |g|^2). The raw step length is
 * d/|grad|, which explodes where the SDF gradient vanishes (a hand vertex was once thrown ~1 m onto the sandal). A step longer than
 * `maxStep` is therefore skipped (the vertex stays where it is). Legitimate steps of the shipped models are all far below the
 * default (largest observed ~5 cm on a 0.9 m creature), so existing geometry and painted-texture layoutHashes are unchanged.
 */
function newtonScale(d: number, h: number, gl: number, maxStep: number): number {
  const s = (d * 2 * h) / gl;
  if (Math.abs(s) * Math.sqrt(gl) > maxStep) {
    if (process.env.FORGE_DEBUG) console.log(`    newton step skipped: ${(Math.abs(s) * Math.sqrt(gl)).toFixed(3)} m > ${maxStep} (|grad| ${(Math.sqrt(gl) / (2 * h)).toFixed(4)}, d ${d.toFixed(4)})`);
    return 0;
  }
  return s;
}

/** Snap vertices onto the zero level set (a few Newton steps; steps longer than `maxStep` metres are skipped). */
export function projectToSurface(positions: Float32Array, sdf: Sdf, iterations = 3, h = 0.004, maxStep = DEFAULT_MAX_STEP): Float32Array {
  const out = Float32Array.from(positions);
  for (let v = 0; v < out.length / 3; v++) {
    let x = out[v * 3]!, y = out[v * 3 + 1]!, z = out[v * 3 + 2]!;
    for (let k = 0; k < iterations; k++) {
      const d = sdf.d(x, y, z);
      const gx = sdf.d(x + h, y, z) - sdf.d(x - h, y, z);
      const gy = sdf.d(x, y + h, z) - sdf.d(x, y - h, z);
      const gz = sdf.d(x, y, z + h) - sdf.d(x, y, z - h);
      const gl = gx * gx + gy * gy + gz * gz;
      if (gl < 1e-12) break;
      const s = newtonScale(d, h, gl, maxStep);
      x -= gx * s; y -= gy * s; z -= gz * s;
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return out;
}

/** Normals from the SDF gradient: smooth, crease-free, independent of triangulation. */
export function sdfNormals(positions: Float32Array, sdf: Sdf, step = 0.012): Float32Array {
  const nv = positions.length / 3;
  const out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const gx = sdf.d(x + step, y, z) - sdf.d(x - step, y, z);
    const gy = sdf.d(x, y + step, z) - sdf.d(x, y - step, z);
    const gz = sdf.d(x, y, z + step) - sdf.d(x, y, z - step);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[v * 3] = gx / l; out[v * 3 + 1] = gy / l; out[v * 3 + 2] = gz / l;
  }
  return out;
}

/**
 * Make triangle winding agree with the (SDF) vertex normals. Surface nets leaves inconsistent winding where two sheets share a cell
 * (sub-voxel features: claws, ear edges, mouth slit); those triangles would be back-face culled as holes. Returns the flip count.
 */
export function orientToNormals(indices: Uint32Array, positions: Float32Array, normals: Float32Array): number {
  let flips = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!, ib = indices[i + 1]!, ic = indices[i + 2]!;
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const wx = positions[c]! - positions[a]!, wy = positions[c + 1]! - positions[a + 1]!, wz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const dot = nx * (normals[a]! + normals[b]! + normals[c]!) + ny * (normals[a + 1]! + normals[b + 1]! + normals[c + 1]!) + nz * (normals[a + 2]! + normals[b + 2]! + normals[c + 2]!);
    if (dot < 0) {
      indices[i + 1] = ic;
      indices[i + 2] = ib;
      flips++;
    }
  }
  return flips;
}

/** Area-weighted mesh normals (for hard-surface meshes or blending with SDF normals). */
export function meshNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const wx = positions[c]! - positions[a]!, wy = positions[c + 1]! - positions[a + 1]!, wz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const o of [a, b, c]) {
      n[o]! += nx; n[o + 1]! += ny; n[o + 2]! += nz;
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!) || 1;
    n[v]! /= l; n[v + 1]! /= l; n[v + 2]! /= l;
  }
  return n;
}
