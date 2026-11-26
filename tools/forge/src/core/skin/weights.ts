import type { Body } from '../sdf/body.ts';
import type { Sdf } from '../sdf/node.ts';
import { adjacency } from '../mesh/simplify.ts';
import type { Skeleton } from './skeleton.ts';

export interface SkinOpts {
  /** softmax temperature in metres: smaller = harder, bigger = softer transitions */
  tau?: number;
  /** Laplacian smoothing passes over the mesh graph */
  smooth?: number;
  /** blend factor per pass toward the neighbour mean */
  lambda?: number;
  /** drop influences below this weight after smoothing */
  minWeight?: number;
}

export interface SkinData {
  /** 4 skeleton joint indices per vertex */
  joints: Uint8Array;
  /** 4 weights per vertex quantised to bytes, always summing to exactly 255 */
  weights: Uint8Array;
  /** dense float weights (vertex x bone) kept for painters that want bone masks */
  dense: Float32Array;
  boneCount: number;
}

/**
 * Skin weights from primitive influence: for each vertex and bone, d_b = distance to the nearest primitive carrying
 * that bone (zero inside it); weight ~ grip * exp(-d_b / tau); then smoothed over the mesh graph and truncated to the
 * strongest four influences.
 */
export function computeSkinWeights(positions: Float32Array, indices: Uint32Array, body: Body, skel: Skeleton, opts: SkinOpts = {}): SkinData {
  const tau = opts.tau ?? 0.02;
  const passes = opts.smooth ?? 6;
  const lambda = opts.lambda ?? 0.5;
  const minW = opts.minWeight ?? 0.025;
  const nv = positions.length / 3;
  const nb = skel.count;
  const sources = body.boneSources();
  const bones: { idx: number; srcs: { sdf: Sdf; grip: number }[] }[] = [];
  for (const [name, srcs] of sources) bones.push({ idx: skel.idx(name), srcs });

  let w = new Float32Array(nv * nb);
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    let sum = 0;
    let best = -1, bestD = Infinity;
    for (const b of bones) {
      let d = Infinity;
      let grip = 1;
      for (const s of b.srcs) {
        const dd = s.sdf.d(x, y, z);
        if (dd < d) { d = dd; grip = s.grip; }
      }
      const dc = d < 0 ? 0 : d;
      if (dc < bestD) { bestD = dc; best = b.idx; }
      const sc = grip * Math.exp(-dc / tau);
      w[v * nb + b.idx] = sc;
      sum += sc;
    }
    if (sum < 1e-12) {
      w[v * nb + best] = 1;
      sum = 1;
    }
    for (let k = 0; k < nb; k++) w[v * nb + k] = w[v * nb + k]! / sum;
  }

  if (passes > 0) {
    const adj = adjacency(nv, indices);
    for (let p = 0; p < passes; p++) {
      const next = new Float32Array(w.length);
      for (let v = 0; v < nv; v++) {
        const nbrs = adj[v]!;
        if (nbrs.length === 0) {
          for (let k = 0; k < nb; k++) next[v * nb + k] = w[v * nb + k]!;
          continue;
        }
        for (let k = 0; k < nb; k++) {
          let s = 0;
          for (const u of nbrs) s += w[u * nb + k]!;
          next[v * nb + k] = (1 - lambda) * w[v * nb + k]! + (lambda * s) / nbrs.length;
        }
      }
      w = next;
    }
  }

  const joints = new Uint8Array(nv * 4);
  const weights = new Uint8Array(nv * 4);
  const dense = new Float32Array(nv * nb);
  const order: number[] = new Array(nb);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < nb; k++) order[k] = k;
    order.sort((a, b) => w[v * nb + b]! - w[v * nb + a]!);
    let sum = 0;
    const top: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const wk = w[v * nb + order[k]!]!;
      if (wk < minW && k > 0) break;
      top.push([order[k]!, wk]);
      sum += wk;
    }
    const q: number[] = top.map(([, wk]) => Math.floor((wk / sum) * 255));
    let rem = 255 - q.reduce((a, b) => a + b, 0);
    for (let k = 0; rem > 0; k = (k + 1) % q.length, rem--) q[k]! += 1;
    top.forEach(([bi], k) => {
      joints[v * 4 + k] = bi;
      weights[v * 4 + k] = q[k]!;
      dense[v * nb + bi] = q[k]! / 255;
    });
  }
  return { joints, weights, dense, boneCount: nb };
}
