// Voxel ambient-occlusion bake: the triangles are splatted into a coarse occupancy grid, then every vertex shoots a
// cosine-weighted bundle of short rays through it. The result darkens vertex colours under eaves, in inner corners,
// between columns and at the ground contact: the hand-painted "dirt in the creases" look without runtime cost.
import type { BufferGeometry } from 'three';

export interface AoOptions {
  /** voxel size in metres (default: ~1/110 of the largest extent, 0.22..0.8) */
  cell?: number;
  /** rays per vertex */
  rays?: number;
  /** occluder search distance in metres */
  reach?: number;
  /** darkness of full occlusion 0..1 */
  strength?: number;
  /** the plane y = ground occludes too (props stand on terrain); null disables */
  ground?: number | null;
}

/** fixed cosine-weighted hemisphere directions (z = surface normal) */
function hemisphere(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const z = Math.sqrt(1 - (k + 0.5) / n);
    const r = Math.sqrt(1 - z * z);
    const phi = k * 2.399963229728653;
    out[k * 3] = r * Math.cos(phi);
    out[k * 3 + 1] = r * Math.sin(phi);
    out[k * 3 + 2] = z;
  }
  return out;
}

export function bakeAO(g: BufferGeometry, o: AoOptions = {}): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const mat = g.getAttribute('aMat');
  const index = g.getIndex();
  if (!pos || !nor || !mat || !index) return;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return;
  const reach = o.reach ?? 2.6;
  const strength = o.strength ?? 0.5;
  const ground = o.ground === undefined ? 0 : o.ground;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  const cell = o.cell ?? Math.min(0.8, Math.max(0.22, Math.max(sx, sy, sz) / 110));
  const inv = 1 / cell;
  const nx = Math.ceil(sx * inv) + 1;
  const ny = Math.ceil(sy * inv) + 1;
  const nz = Math.ceil(sz * inv) + 1;
  const occ = new Uint8Array(nx * ny * nz);
  const ox = bb.min.x;
  const oy = bb.min.y;
  const oz = bb.min.z;

  const P = pos.array as ArrayLike<number>;
  const I = index.array as ArrayLike<number>;
  const step = cell * 0.55;
  for (let t = 0; t < I.length; t += 3) {
    const a = (I[t] as number) * 3;
    const b = (I[t + 1] as number) * 3;
    const c = (I[t + 2] as number) * 3;
    const ax = P[a] as number;
    const ay = P[a + 1] as number;
    const az = P[a + 2] as number;
    const bx = (P[b] as number) - ax;
    const by = (P[b + 1] as number) - ay;
    const bz = (P[b + 2] as number) - az;
    const cx = (P[c] as number) - ax;
    const cy = (P[c + 1] as number) - ay;
    const cz = (P[c + 2] as number) - az;
    const longest = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(bx - cx, by - cy, bz - cz));
    const n = Math.min(300, Math.max(1, Math.ceil(longest / step)));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const fx = ax + (bx * i + cx * j) / n;
        const fy = ay + (by * i + cy * j) / n;
        const fz = az + (bz * i + cz * j) / n;
        const vx = Math.min(nx - 1, Math.max(0, Math.floor((fx - ox) * inv)));
        const vy = Math.min(ny - 1, Math.max(0, Math.floor((fy - oy) * inv)));
        const vz = Math.min(nz - 1, Math.max(0, Math.floor((fz - oz) * inv)));
        occ[(vz * ny + vy) * nx + vx] = 1;
      }
    }
  }

  const rays = o.rays ?? 18;
  const dirs = hemisphere(rays);
  const stepLen = cell * 0.85;
  const nSteps = Math.max(2, Math.ceil(reach / stepLen));
  const count = pos.count;
  const Nn = nor.array as ArrayLike<number>;
  const M = mat.array as unknown as Float32Array;
  for (let v = 0; v < count; v++) {
    if ((M[v * 3 + 1] as number) > 0) continue;
    const px = P[v * 3] as number;
    const py = P[v * 3 + 1] as number;
    const pz = P[v * 3 + 2] as number;
    const nnx = Nn[v * 3] as number;
    const nny = Nn[v * 3 + 1] as number;
    const nnz = Nn[v * 3 + 2] as number;
    // tangent frame around the normal
    let tx: number;
    let ty: number;
    let tz: number;
    if (Math.abs(nny) < 0.9) {
      tx = nnz;
      ty = 0;
      tz = -nnx;
    } else {
      tx = 0;
      ty = -nnz;
      tz = nny;
    }
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bxv = nny * tz - nnz * ty;
    const byv = nnz * tx - nnx * tz;
    const bzv = nnx * ty - nny * tx;
    // start slightly off the surface so the vertex's own voxel never counts
    const sx0 = px + nnx * cell * 0.7;
    const sy0 = py + nny * cell * 0.7;
    const sz0 = pz + nnz * cell * 0.7;
    let acc = 0;
    for (let k = 0; k < rays; k++) {
      const lx = dirs[k * 3] as number;
      const ly = dirs[k * 3 + 1] as number;
      const lz = dirs[k * 3 + 2] as number;
      const dx = tx * lx + bxv * ly + nnx * lz;
      const dy = ty * lx + byv * ly + nny * lz;
      const dz = tz * lx + bzv * ly + nnz * lz;
      for (let s = 1; s <= nSteps; s++) {
        const d = s * stepLen;
        const x = sx0 + dx * d;
        const y = sy0 + dy * d;
        const z = sz0 + dz * d;
        let hit = ground !== null && y < ground;
        if (!hit) {
          const ix = Math.floor((x - ox) * inv);
          const iy = Math.floor((y - oy) * inv);
          const iz = Math.floor((z - oz) * inv);
          hit = ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && occ[(iz * ny + iy) * nx + ix] === 1;
        }
        if (hit) {
          acc += 1 - d / (reach + stepLen);
          break;
        }
      }
    }
    M[v * 3 + 2] = Math.max(0.3, 1 - (strength * acc) / rays);
  }
  mat.needsUpdate = true;
}
