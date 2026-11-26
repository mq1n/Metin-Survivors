// World kit (C7) islands: a domain-warped island field (an archipelago that is not a compass drawing) with signed
// distance + island id, the narrow-gap bridge-site finder and a spanning-tree picker that keeps every island reachable.

// gaps, about 33 % of the map walkable. Deterministic (see util.ts).
//
// Model: Voronoi cells of jittered seed points (dart throwing + one damped Lloyd step) in a domain-warped space; each
// island is its cell shrunk by half the local gap (per pair base width + noise along the coast, so channels are never a
// constant-width canal), corners rounded with a polynomial smooth-min. Anchors pin islands (centre + minimum radius).
import { clamp, fbm, smoothstep } from '../noise';
import { hash2, WorldRng } from '../rng';
import { smax, smin } from '../shapes';
import type { BridgeSite, IslandField, IslandFieldSpec, IslandInfo, IslandSample, Vec2 } from './types';
import { PI, subSeed } from './util';

/** Domain-warped island field (an archipelago that is not a compass drawing): sdf + id + bridge-site finder. */
export function islandField(spec: IslandFieldSpec): IslandField {
  const R = Math.max(1, spec.radius);
  const seed = spec.seed | 0;
  const g0 = Math.max(0, Math.min(spec.gap[0], spec.gap[1]));
  const g1 = Math.max(0, spec.gap[0], spec.gap[1]);
  const W = Math.max(0, spec.warp);
  const anchors = spec.anchors ?? [];
  const outsideLand = spec.outside === 'land';
  const target = Math.max(1, Math.round(spec.count));
  // hex-packing distance between seeds for `target` cells in the disc
  const spacing = Math.sqrt(((PI * R * R) / target) * 1.1547);
  const round = Math.max(0.01, spec.round ?? spacing * 0.2);

  // ---- 1. seeds: anchors first, then dart throwing, then one damped Lloyd step -----------------------------------------
  const sx: number[] = [];
  const sz: number[] = [];
  const sr: number[] = [];
  for (const a of anchors) {
    sx.push(a.x);
    sz.push(a.z);
    sr.push(a.r);
  }
  const A = anchors.length;
  const minD = spacing * 0.72;
  const clearOf = (x: number, z: number, self: number): boolean => {
    for (let j = 0; j < sx.length; j++) {
      if (j === self) continue;
      const dx = x - (sx[j] as number);
      const dz = z - (sz[j] as number);
      const need = j < A ? Math.max(minD, 2 * (sr[j] as number) + g1 + 0.5 * W) : minD;
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  };
  const rng = new WorldRng(subSeed(seed, 0x15a1));
  for (let tries = 0; sx.length < target && tries < target * 400; tries++) {
    const u = rng.next() * 2 - 1;
    const v = rng.next() * 2 - 1;
    if (u * u + v * v > 1) continue;
    const x = u * R * 0.97;
    const z = v * R * 0.97;
    if (!clearOf(x, z, -1)) continue;
    sx.push(x);
    sz.push(z);
    sr.push(0);
  }
  const N = sx.length;
  if (N > A + 1) {
    const step = Math.max(2, spacing / 8);
    const m = Math.ceil((2 * R) / step);
    const sumX = new Float64Array(N);
    const sumZ = new Float64Array(N);
    const cnt = new Float64Array(N);
    for (let j = 0; j <= m; j++) {
      const z = -R + j * step;
      for (let i = 0; i <= m; i++) {
        const x = -R + i * step;
        if (x * x + z * z > R * R) continue;
        let best = 1e300;
        let bi = 0;
        for (let k = 0; k < N; k++) {
          const dx = x - (sx[k] as number);
          const dz = z - (sz[k] as number);
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bi = k;
          }
        }
        sumX[bi] = (sumX[bi] as number) + x;
        sumZ[bi] = (sumZ[bi] as number) + z;
        cnt[bi] = (cnt[bi] as number) + 1;
      }
    }
    for (let k = A; k < N; k++) {
      const c = cnt[k] as number;
      if (c <= 0) continue;
      const nx = (sx[k] as number) + 0.5 * ((sumX[k] as number) / c - (sx[k] as number));
      const nz = (sz[k] as number) + 0.5 * ((sumZ[k] as number) / c - (sz[k] as number));
      if (clearOf(nx, nz, k)) {
        sx[k] = nx;
        sz[k] = nz;
      }
    }
  }

  // ---- 2. pair tables: bisector normal / offset, per-pair gap base ----------------------------------------------------
  const pnx = new Float64Array(N * N);
  const pnz = new Float64Array(N * N);
  const pc = new Float64Array(N * N);
  const pg = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const dx = (sx[j] as number) - (sx[i] as number);
      const dz = (sz[j] as number) - (sz[i] as number);
      const l = Math.sqrt(dx * dx + dz * dz) || 1e-9;
      const nx = dx / l;
      const nz = dz / l;
      const o = i * N + j;
      pnx[o] = nx;
      pnz[o] = nz;
      pc[o] = nx * 0.5 * ((sx[i] as number) + (sx[j] as number)) + nz * 0.5 * ((sz[i] as number) + (sz[j] as number));
      pg[o] = hash2(Math.min(i, j), Math.max(i, j), seed);
    }
  }

  // ---- 3. the exact field ---------------------------------------------------------------------------------------------
  const lam = spacing * 0.85;
  const sw1 = subSeed(seed, 11);
  const sw2 = subSeed(seed, 12);
  const sg = subSeed(seed, 13);
  const exact = (x: number, z: number, out: IslandSample): IslandSample => {
    // domain warp, faded out round the anchors so a pinned island keeps its centre and minimum radius
    let k = 1;
    for (let a = 0; a < A; a++) {
      const dx = x - (sx[a] as number);
      const dz = z - (sz[a] as number);
      const m = smoothstep((sr[a] as number) * 0.5, (sr[a] as number) * 1.25, Math.sqrt(dx * dx + dz * dz));
      if (m < k) k = m;
    }
    const amp = W * k * 1.6;
    const qx = amp > 0 ? x + amp * fbm(x / lam + 3.1, z / lam - 7.7, sw1, 3) : x;
    const qz = amp > 0 ? z + amp * fbm(x / lam - 4.3, z / lam + 2.9, sw2, 3) : z;
    let i = 0;
    let best = 1e300;
    for (let j = 0; j < N; j++) {
      const dx = qx - (sx[j] as number);
      const dz = qz - (sz[j] as number);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        i = j;
      }
    }
    // one gap noise per sample: channels widen and narrow along their course
    const gn = 0.5 + 1.6 * fbm(x / 38, z / 38, sg, 2);
    let inland = 1e9;
    let first = true;
    const row = i * N;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const o = row + j;
      const e = (pc[o] as number) - ((pnx[o] as number) * qx + (pnz[o] as number) * qz);
      if (!first && e - g1 * 0.5 > inland + round) continue;
      const g01 = clamp(0.55 * (pg[o] as number) + 0.45 * gn, 0, 1);
      const v = e - 0.5 * (g0 + (g1 - g0) * g01);
      inland = first ? v : smin(inland, v, round);
      first = false;
    }
    let id = i;
    const rq = Math.sqrt(qx * qx + qz * qz);
    if (outsideLand) {
      const o2 = rq - R;
      if (first || o2 > inland) id = -1;
      inland = first ? o2 : smax(inland, o2, round);
    } else {
      const o2 = R - rq;
      inland = first ? o2 : smin(inland, o2, round);
    }
    out.d = -inland;
    out.id = id;
    return out;
  };

  // ---- 4. optional baked grid -----------------------------------------------------------------------------------------
  const cell = Math.max(0, spec.grid ?? 0);
  const ext = R + g1 + W + 8;
  let gD: Float32Array | null = null;
  let gI: Int32Array | null = null;
  let gn = 0;
  const tmp: IslandSample = { d: 0, id: 0 };
  if (cell > 0) {
    gn = Math.ceil((2 * ext) / cell) + 1;
    gD = new Float32Array(gn * gn);
    gI = new Int32Array(gn * gn);
    for (let j = 0; j < gn; j++) {
      const z = -ext + j * cell;
      for (let i = 0; i < gn; i++) {
        exact(-ext + i * cell, z, tmp);
        gD[j * gn + i] = tmp.d;
        gI[j * gn + i] = tmp.id;
      }
    }
  }
  const sample = (x: number, z: number, out: IslandSample): IslandSample => {
    if (gD && gI) {
      const fx = (x + ext) / cell;
      const fz = (z + ext) / cell;
      if (fx >= 0 && fz >= 0 && fx < gn - 1 && fz < gn - 1) {
        const i = Math.floor(fx);
        const j = Math.floor(fz);
        const tx = fx - i;
        const tz = fz - j;
        const o = j * gn + i;
        const a = (gD[o] as number) + ((gD[o + 1] as number) - (gD[o] as number)) * tx;
        const b = (gD[o + gn] as number) + ((gD[o + gn + 1] as number) - (gD[o + gn] as number)) * tx;
        out.d = a + (b - a) * tz;
        out.id = gI[(tz < 0.5 ? j : j + 1) * gn + (tx < 0.5 ? i : i + 1)] as number;
        return out;
      }
    }
    return exact(x, z, out);
  };

  // ---- 5. island table (2 m scan): area, most inland point, centroid; land links -------------------------------------
  const SCAN = 2;
  const scanExt = R + W + 6;
  const sn = Math.ceil((2 * scanExt) / SCAN) + 1;
  const area = new Float64Array(N);
  const deep = new Float64Array(N).fill(1e9);
  const deepX = new Float64Array(N);
  const deepZ = new Float64Array(N);
  const cxs = new Float64Array(N);
  const czs = new Float64Array(N);
  const rowId = new Int32Array(sn);
  const rowLand = new Uint8Array(sn);
  const prevId = new Int32Array(sn);
  const prevLand = new Uint8Array(sn);
  const linkSet = new Set<string>();
  const links: Array<readonly [number, number]> = [];
  const link = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo},${hi}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push([lo, hi]);
  };
  for (let j = 0; j < sn; j++) {
    const z = -scanExt + j * SCAN;
    for (let i = 0; i < sn; i++) {
      const x = -scanExt + i * SCAN;
      sample(x, z, tmp);
      const land = tmp.d < 0 ? 1 : 0;
      rowId[i] = tmp.id;
      rowLand[i] = land;
      if (land) {
        if (i > 0 && rowLand[i - 1] && rowId[i - 1] !== tmp.id) link(rowId[i - 1] as number, tmp.id);
        if (j > 0 && prevLand[i] && prevId[i] !== tmp.id) link(prevId[i] as number, tmp.id);
        if (tmp.id >= 0 && x * x + z * z <= R * R) {
          const id = tmp.id;
          area[id] = (area[id] as number) + SCAN * SCAN;
          cxs[id] = (cxs[id] as number) + x;
          czs[id] = (czs[id] as number) + z;
          if (tmp.d < (deep[id] as number)) {
            deep[id] = tmp.d;
            deepX[id] = x;
            deepZ[id] = z;
          }
        }
      }
    }
    prevId.set(rowId);
    prevLand.set(rowLand);
  }
  const islands: IslandInfo[] = [];
  for (let id = 0; id < N; id++) {
    const ar = area[id] as number;
    const cells = ar / (SCAN * SCAN);
    const pinned = id < A;
    islands.push({
      id,
      x: pinned ? (sx[id] as number) : ar > 0 ? (deepX[id] as number) : (sx[id] as number),
      z: pinned ? (sz[id] as number) : ar > 0 ? (deepZ[id] as number) : (sz[id] as number),
      area: ar,
      inner: ar > 0 ? -(deep[id] as number) : 0,
      cx: cells > 0 ? (cxs[id] as number) / cells : (sx[id] as number),
      cz: cells > 0 ? (czs[id] as number) / cells : (sz[id] as number),
      seedX: sx[id] as number,
      seedZ: sz[id] as number,
    });
  }

  // ---- 6. bridge sites -------------------------------------------------------------------------------------------------
  const bridgeSites = (opts?: { minSpan?: number; maxSpan?: number; perPair?: number; sep?: number; landing?: number }): BridgeSite[] => {
    const minSpan = opts?.minSpan ?? Math.max(2, g0 * 0.5);
    const maxSpan = opts?.maxSpan ?? g1 * 1.8 + 4;
    const perPair = Math.max(1, Math.floor(opts?.perPair ?? 1));
    const sep = opts?.sep ?? Math.max(30, maxSpan * 2);
    const landing = opts?.landing ?? 2.5;
    // coast points: land within 1.6 m of the coast, on a 1.5 m lattice
    const C = 1.5;
    const ce = R + W + g1 + 6;
    const cn = Math.ceil((2 * ce) / C) + 1;
    const px: number[] = [];
    const pz: number[] = [];
    const pid: number[] = [];
    for (let j = 0; j < cn; j++) {
      const z = -ce + j * C;
      for (let i = 0; i < cn; i++) {
        const x = -ce + i * C;
        sample(x, z, tmp);
        if (tmp.d <= 0 && tmp.d > -1.6) {
          px.push(x);
          pz.push(z);
          pid.push(tmp.id);
        }
      }
    }
    // spatial hash of the coast points
    const HC = 8;
    const hn = Math.ceil((2 * ce) / HC) + 1;
    const hcell = (v: number): number => {
      const k = Math.floor((v + ce) / HC);
      return k < 0 ? 0 : k >= hn ? hn - 1 : k;
    };
    const buckets: number[][] = Array.from({ length: hn * hn }, () => []);
    for (let p = 0; p < px.length; p++) (buckets[hcell(pz[p] as number) * hn + hcell(px[p] as number)] as number[]).push(p);
    // candidate per coast point: the nearest coast point of another island
    const reachC = maxSpan + 3.2;
    const cand: Array<{ p: number; q: number; d: number }> = [];
    for (let p = 0; p < px.length; p++) {
      const x = px[p] as number;
      const z = pz[p] as number;
      const id = pid[p] as number;
      let best = reachC * reachC;
      let bq = -1;
      const i0 = hcell(x - reachC);
      const i1 = hcell(x + reachC);
      const j0 = hcell(z - reachC);
      const j1 = hcell(z + reachC);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          for (const q of buckets[j * hn + i] as number[]) {
            if (pid[q] === id) continue;
            const dx = (px[q] as number) - x;
            const dz = (pz[q] as number) - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < best) {
              best = d2;
              bq = q;
            }
          }
        }
      }
      if (bq >= 0) cand.push({ p, q: bq, d: Math.sqrt(best) });
    }
    cand.sort((a, b) => a.d - b.d || a.p - b.p);
    // greedy: shortest first, one water interval from island a to island b, separated from earlier sites
    const out: BridgeSite[] = [];
    const perKey = new Map<string, number>();
    const s2: IslandSample = { d: 0, id: 0 };
    for (const c of cand) {
      const a0 = pid[c.p] as number;
      const b0 = pid[c.q] as number;
      const a = Math.min(a0, b0);
      const b = Math.max(a0, b0);
      const key = `${a},${b}`;
      if ((perKey.get(key) ?? 0) >= perPair) continue;
      const ax = px[c.p] as number;
      const az = pz[c.p] as number;
      const bx = px[c.q] as number;
      const bz = pz[c.q] as number;
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;
      let near = false;
      for (const s of out) {
        const dx = (s.x0 + s.x1) * 0.5 - mx;
        const dz = (s.z0 + s.z1) * 0.5 - mz;
        const lim = s.a === a && s.b === b ? sep : 12;
        if (dx * dx + dz * dz < lim * lim) {
          near = true;
          break;
        }
      }
      if (near) continue;
      // march p → q
      const L = c.d;
      const steps = Math.max(2, Math.ceil(L / 0.5));
      let enter = -1;
      let exit = -1;
      let ok = true;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        sample(ax + (bx - ax) * t, az + (bz - az) * t, s2);
        if (s2.d > 0) {
          if (enter < 0) enter = k;
          else if (exit >= 0) {
            ok = false;
            break;
          }
        } else {
          if (enter >= 0 && exit < 0) exit = k;
          if (enter < 0 && s2.id !== a0) ok = false;
          if (exit >= 0 && s2.id !== b0) ok = false;
          if (!ok) break;
        }
      }
      if (!ok || enter <= 0 || exit <= enter) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const t0 = (enter - 0.5) / steps;
      const t1 = (exit - 0.5) / steps;
      const span = (t1 - t0) * L;
      if (span < minSpan || span > maxSpan) continue;
      const w0x = ax + (bx - ax) * t0;
      const w0z = az + (bz - az) * t0;
      const w1x = ax + (bx - ax) * t1;
      const w1z = az + (bz - az) * t1;
      const x0 = w0x - ux * landing;
      const z0 = w0z - uz * landing;
      const x1 = w1x + ux * landing;
      const z1 = w1z + uz * landing;
      if (sample(x0, z0, s2).d > -0.3 || sample(x1, z1, s2).d > -0.3) continue;
      // report the strip from the lower id to the higher id
      const flip = a0 !== a;
      out.push(flip ? { a, b, x0: x1, z0: z1, x1: x0, z1: z0, span } : { a, b, x0, z0, x1, z1, span });
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    return out.sort((p, q) => p.span - q.span);
  };

  return { islands, sample, bridgeSites, links, spacing };
}

/**
 * Control points for a road from `a` to `b` that stays at least `inland` m from every coast (A* on a `cell` m grid,
 * coast-shy cost so the track keeps to the middle of the land, then line-of-sight simplification). Feed the result to a
 * RoadSpec (`pts`); roadNetwork smooths and wanders it. Returns [a, b] when no inland path exists within `margin` m of
 * the two points. Works with any `sample` (island field, or a recipe's own land test via { d, id }).
 */
export function routeOnLand(
  field: Pick<IslandField, 'sample'>,
  a: Vec2,
  b: Vec2,
  opts?: { cell?: number; inland?: number; margin?: number },
): Vec2[] {
  const cell = Math.max(1, opts?.cell ?? 4);
  const inland = Math.max(0, opts?.inland ?? 3);
  const margin = Math.max(cell * 2, opts?.margin ?? 60);
  const x0 = Math.min(a[0], b[0]) - margin;
  const z0 = Math.min(a[1], b[1]) - margin;
  const nx = Math.ceil((Math.max(a[0], b[0]) + margin - x0) / cell) + 1;
  const nz = Math.ceil((Math.max(a[1], b[1]) + margin - z0) / cell) + 1;
  const n = nx * nz;
  const s: IslandSample = { d: 0, id: 0 };
  const cost = new Float64Array(n);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const d = field.sample(x0 + i * cell, z0 + j * cell, s).d;
      // blocked near the coast; otherwise cheaper the further inland (up to 8 m past the limit)
      cost[j * nx + i] = d > -inland ? -1 : 1 + 1.5 * (1 - smoothstep(inland, inland + 8, -d));
    }
  }
  const idx = (x: number, z: number): number => {
    const i = Math.min(nx - 1, Math.max(0, Math.round((x - x0) / cell)));
    const j = Math.min(nz - 1, Math.max(0, Math.round((z - z0) / cell)));
    return j * nx + i;
  };
  const start = idx(a[0], a[1]);
  const goal = idx(b[0], b[1]);
  // the end points themselves may sit near a coast (bridge heads): let them in
  if ((cost[start] as number) < 0) cost[start] = 3;
  if ((cost[goal] as number) < 0) cost[goal] = 3;
  const gi = goal % nx;
  const gj = (goal - gi) / nx;
  const g = new Float64Array(n).fill(1e18);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // binary heap of (f, node); ties broken by node index so the result is deterministic
  const hf: number[] = [];
  const hn: number[] = [];
  const less = (p: number, q: number): boolean => (hf[p] as number) < (hf[q] as number) || ((hf[p] as number) === (hf[q] as number) && (hn[p] as number) < (hn[q] as number));
  const swap = (p: number, q: number): void => {
    const f = hf[p] as number;
    const v = hn[p] as number;
    hf[p] = hf[q] as number;
    hn[p] = hn[q] as number;
    hf[q] = f;
    hn[q] = v;
  };
  const push = (f: number, v: number): void => {
    hf.push(f);
    hn.push(v);
    let c = hf.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!less(c, p)) break;
      swap(c, p);
      c = p;
    }
  };
  const pop = (): number => {
    const top = hn[0] as number;
    const lastF = hf.pop() as number;
    const lastN = hn.pop() as number;
    if (hf.length > 0) {
      hf[0] = lastF;
      hn[0] = lastN;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < hf.length && less(l, m)) m = l;
        if (r < hf.length && less(r, m)) m = r;
        if (m === c) break;
        swap(c, m);
        c = m;
      }
    }
    return top;
  };
  const h = (v: number): number => {
    const i = v % nx;
    const j = (v - i) / nx;
    const dx = i - gi;
    const dz = j - gj;
    return Math.sqrt(dx * dx + dz * dz) * cell;
  };
  g[start] = 0;
  push(h(start), start);
  let found = false;
  while (hf.length > 0) {
    const v = pop();
    if (closed[v]) continue;
    closed[v] = 1;
    if (v === goal) {
      found = true;
      break;
    }
    const i = v % nx;
    const j = (v - i) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const w = nj * nx + ni;
        const c = cost[w] as number;
        if (c < 0 || closed[w]) continue;
        const step = (di !== 0 && dj !== 0 ? 1.4142135623730951 : 1) * cell * 0.5 * (c + (cost[v] as number));
        const ng = (g[v] as number) + step;
        if (ng < (g[w] as number)) {
          g[w] = ng;
          from[w] = v;
          push(ng + h(w), w);
        }
      }
    }
  }
  if (!found) return [[a[0], a[1]], [b[0], b[1]]];
  const chain: number[] = [];
  for (let v = goal; v >= 0; v = from[v] as number) {
    chain.push(v);
    if (v === start) break;
  }
  chain.reverse();
  const pos = (v: number): Vec2 => {
    const i = v % nx;
    return [x0 + i * cell, z0 + ((v - i) / nx) * cell];
  };
  // line-of-sight simplification: keep the farthest node reachable along an inland straight line
  const clear = (p: Vec2, q: Vec2): boolean => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    const k = Math.max(1, Math.ceil(len / 2));
    for (let t = 1; t < k; t++) if (field.sample(p[0] + (dx * t) / k, p[1] + (dz * t) / k, s).d > -inland * 0.75) return false;
    return true;
  };
  const out: Vec2[] = [[a[0], a[1]]];
  let cur: Vec2 = [a[0], a[1]];
  let k = 0;
  while (k < chain.length - 1) {
    let best = k + 1;
    for (let q = chain.length - 1; q > k + 1; q--) {
      const target: Vec2 = q === chain.length - 1 ? [b[0], b[1]] : pos(chain[q] as number);
      if (clear(cur, target)) {
        best = q;
        break;
      }
    }
    k = best;
    cur = k === chain.length - 1 ? [b[0], b[1]] : pos(chain[k] as number);
    out.push(cur);
  }
  return out;
}

/**
 * Picks bridges so every island (area ≥ minArea) is reachable: a spanning tree over the sites (shortest first, land
 * links count as free connections), then `extra` more of the shortest unused sites for loops. `unconnected` lists the
 * islands no site could reach (widen maxSpan, add a ford or drop them). `ignore`: ids that are not walkable connectors
 * (e.g. [-1] when the mainland ring lies under the rim, outside the arena): their links and sites are dropped.
 */
export function connectIslands(
  field: IslandField,
  sites: ReadonlyArray<BridgeSite>,
  opts?: { extra?: number; minArea?: number; ignore?: ReadonlyArray<number> },
): { sites: BridgeSite[]; unconnected: number[] } {
  const minArea = opts?.minArea ?? 40;
  const extra = Math.max(0, Math.floor(opts?.extra ?? 0));
  const ignore = new Set(opts?.ignore ?? []);
  const nodes = new Set<number>();
  for (const i of field.islands) if (i.area >= minArea && !ignore.has(i.id)) nodes.add(i.id);
  const usesMainland = !ignore.has(-1) && (sites.some((s) => s.a === -1) || (field.links ?? []).some((l) => l[0] === -1));
  if (usesMainland) nodes.add(-1);
  const parent = new Map<number, number>();
  for (const n of nodes) parent.set(n, n);
  const find = (n: number): number => {
    let r = n;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    let c = n;
    while (c !== r) {
      const next = parent.get(c) as number;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
    return true;
  };
  for (const [a, b] of field.links ?? []) if (nodes.has(a) && nodes.has(b)) union(a, b);
  const sorted = sites.slice().sort((p, q) => p.span - q.span);
  const chosen: BridgeSite[] = [];
  const used = new Set<BridgeSite>();
  for (const s of sorted) {
    if (!nodes.has(s.a) || !nodes.has(s.b)) continue;
    if (union(s.a, s.b)) {
      chosen.push(s);
      used.add(s);
    }
  }
  const bridged = new Set(chosen.map((s) => `${s.a},${s.b}`));
  let added = 0;
  for (const s of sorted) {
    if (added >= extra) break;
    if (used.has(s) || !nodes.has(s.a) || !nodes.has(s.b) || bridged.has(`${s.a},${s.b}`)) continue;
    chosen.push(s);
    used.add(s);
    bridged.add(`${s.a},${s.b}`);
    added++;
  }
  // the main component: the mainland ring, else the first anchor / largest island
  let main = usesMainland ? -1 : -2;
  if (main === -2) {
    let bestArea = -1;
    for (const i of field.islands) {
      if (!nodes.has(i.id)) continue;
      if (i.area > bestArea) {
        bestArea = i.area;
        main = i.id;
      }
    }
  }
  const unconnected: number[] = [];
  if (main !== -2) {
    const root = find(main);
    for (const n of nodes) if (n !== -1 && find(n) !== root) unconnected.push(n);
  }
  return { sites: chosen, unconnected: unconnected.sort((a, b) => a - b) };
}
