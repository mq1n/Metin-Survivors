// World kit (C7) roads: wandering ribbons with noise-varied width, automatic junction clearings, round dead-end
// clearings, edge wear and grass fringe as paint weights, optional graded benches (switchbacks), plus `switchback()`.

// widening at junctions, ending in circular clearings, with wear and a soft grass fringe; no CAD arcs, no constant width.
// Deterministic (see util.ts): + − × ÷ sqrt floor abs min max, noise.ts and rng.ts only.
import { clamp, fbm, smoothstep } from '../noise';
import { WorldRng } from '../rng';
import type { RoadClearing, RoadNetwork, RoadNetworkSpec, RoadPoint, RoadSample, Vec2 } from './types';
import { Path2, smoothCurve, subSeed } from './util';

/** metres between centre-line vertices (width / wander features are 25 m+ long, so 3 m keeps every bend) */
const STEP = 3;
/** spatial hash cell (m) */
const CELL = 8;

interface BuiltRoad {
  /** smoothed control line before the wander (for snapping later roads onto this one) */
  base: Path2;
  /** wandered centre line */
  path: Path2;
  /** half width per centre vertex */
  hw: Float64Array;
  hwMax: number;
  ends: [number, number];
  graded: boolean;
  g0: number;
  g1: number;
  bench: number;
}

/** A fresh RoadSample with every field set (reuse it across sample() calls). */
export function roadSample(): Required<RoadSample> {
  return { road: 0, wear: 0, fringe: 0, clearing: 0, d: 0, grade: 0, bench: 0 };
}

/** Wandering road ribbons with noise-varied width, junction and end clearings, edge wear and grass fringe. */
export function roadNetwork(spec: RoadNetworkSpec): RoadNetwork {
  const seed = spec.seed | 0;
  const junctionClearing = spec.junctionClearing ?? 3;
  const wearW = Math.max(0, spec.wear ?? 1.2);
  const fringeW = Math.max(0, spec.fringe ?? 2);
  const reach = Math.max(1, spec.reach ?? 16);
  const soft = Math.max(0.05, spec.soft ?? 0.6);
  const edgeNoise = Math.max(0, spec.edgeNoise ?? 0.6);
  const snapTol = Math.max(0, spec.snap ?? 1.5);
  const noiseSeed = subSeed(seed, 77);

  // ---- 1. centre lines: snap ends onto earlier roads, smooth, wander, vary the width -----------------------------------
  const built: BuiltRoad[] = [];
  const tmpS = { s: 0 };
  spec.roads.forEach((r, k) => {
    if (r.pts.length < 2) throw new Error(`world/kit roadNetwork: road ${k} needs at least 2 control points`);
    const ctrl: Array<[number, number]> = r.pts.map((p) => [p[0], p[1]]);
    for (const e of [0, ctrl.length - 1]) {
      const p = ctrl[e] as [number, number];
      for (let j = 0; j < built.length; j++) {
        const b = built[j] as BuiltRoad;
        const d = b.base.nearest(p[0], p[1], tmpS, snapTol + 1);
        if (d <= snapTol) {
          // the same spot on the earlier road's wandered line (base and wandered lines share their vertex indices, so
          // the base arc length maps to the wandered arc length through the per-vertex table)
          const pt = b.path.at(b.base.lerpAt(b.path.s, tmpS.s), { x: 0, z: 0, tx: 0, tz: 0 });
          ctrl[e] = [pt.x, pt.z];
          break;
        }
      }
    }
    const basePts = smoothCurve(ctrl, STEP);
    const base = new Path2(basePts);
    const n = base.n;
    const total = base.total;
    const wander = Math.max(0, r.wander ?? 6);
    const wl = Math.max(4, r.wavelength ?? 40);
    const taperLen = Math.max(1e-3, Math.min(wl * 0.5, total * 0.3));
    const ws = subSeed(seed, 1000 + k);
    const px = new Float64Array(n);
    const pz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = base.s[i] as number;
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < n - 1 ? i + 1 : i;
      let tx = (base.x[i1] as number) - (base.x[i0] as number);
      let tz = (base.z[i1] as number) - (base.z[i0] as number);
      const tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl;
      tz /= tl;
      const taper = smoothstep(0, taperLen, s) * smoothstep(0, taperLen, total - s);
      const off = wander * taper * clamp(1.6 * fbm(s / wl, 0.37 + k * 3.71, ws, 2), -1, 1);
      // left of travel = (tz, −tx)
      px[i] = (base.x[i] as number) + tz * off;
      pz[i] = (base.z[i] as number) - tx * off;
    }
    // two light relaxation passes take out kinks where the wander meets a tight bend (end points stay)
    for (let pass = 0; pass < 2; pass++) {
      let prevX = px[0] as number;
      let prevZ = pz[0] as number;
      for (let i = 1; i < n - 1; i++) {
        const cx = px[i] as number;
        const cz = pz[i] as number;
        px[i] = 0.25 * prevX + 0.5 * cx + 0.25 * (px[i + 1] as number);
        pz[i] = 0.25 * prevZ + 0.5 * cz + 0.25 * (pz[i + 1] as number);
        prevX = cx;
        prevZ = cz;
      }
    }
    const centre: Vec2[] = [];
    for (let i = 0; i < n; i++) centre.push([px[i] as number, pz[i] as number]);
    const path = new Path2(centre);
    const hw = new Float64Array(n);
    const w0 = Math.min(r.width[0], r.width[1]);
    const w1 = Math.max(r.width[0], r.width[1]);
    const hs = subSeed(seed, 2000 + k);
    let hwMax = 0;
    for (let i = 0; i < n; i++) {
      const s = path.s[i] as number;
      const t = clamp(0.5 + 2 * fbm(s / (wl * 0.75), 5.3 + k * 1.37, hs, 2), 0, 1);
      const h = 0.5 * (w0 + (w1 - w0) * t);
      hw[i] = h;
      if (h > hwMax) hwMax = h;
    }
    const ec = r.endClearing;
    const ends: [number, number] = typeof ec === 'number' ? [ec, ec] : ec ? [ec[0], ec[1]] : [0, 0];
    built.push({
      base,
      path,
      hw,
      hwMax,
      ends,
      graded: r.grade !== undefined,
      g0: r.grade ? r.grade[0] : 0,
      g1: r.grade ? r.grade[1] : 0,
      bench: Math.max(0.5, r.bench ?? 3),
    });
  });

  // ---- 2. junctions: road ends on another road, crossings; then dead-end clearings -------------------------------------
  interface J {
    x: number;
    z: number;
    r: number;
    w: number;
  }
  const raw: J[] = [];
  const connected: boolean[] = [];
  const pt: { x: number; z: number; tx: number; tz: number } = { x: 0, z: 0, tx: 0, tz: 0 };
  built.forEach((a, k) => {
    for (const e of [0, 1]) {
      const i = e === 0 ? 0 : a.path.n - 1;
      const ex = a.path.x[i] as number;
      const ez = a.path.z[i] as number;
      const ehw = a.hw[i] as number;
      let hit = false;
      built.forEach((b, j) => {
        if (j === k) return;
        const d = b.path.nearest(ex, ez, tmpS, ehw + b.hwMax + 2);
        const bhw = b.path.lerpAt(b.hw, tmpS.s);
        if (d > ehw + bhw + 1) return;
        b.path.at(tmpS.s, pt);
        raw.push({ x: (ex + pt.x) * 0.5, z: (ez + pt.z) * 0.5, r: Math.max(ehw, bhw) + junctionClearing, w: 1 });
        hit = true;
      });
      connected[k * 2 + e] = hit;
    }
  });
  // crossings (segment / segment) between different roads
  for (let k = 0; k < built.length; k++) {
    const a = built[k] as BuiltRoad;
    for (let j = k + 1; j < built.length; j++) {
      const b = built[j] as BuiltRoad;
      if (a.path.maxX < b.path.minX || b.path.maxX < a.path.minX || a.path.maxZ < b.path.minZ || b.path.maxZ < a.path.minZ) continue;
      for (let i = 0; i < a.path.n - 1; i++) {
        const ax = a.path.x[i] as number;
        const az = a.path.z[i] as number;
        const bx = a.path.x[i + 1] as number;
        const bz = a.path.z[i + 1] as number;
        const sminX = Math.min(ax, bx);
        const smaxX = Math.max(ax, bx);
        const sminZ = Math.min(az, bz);
        const smaxZ = Math.max(az, bz);
        for (let q = 0; q < b.path.n - 1; q++) {
          const cx = b.path.x[q] as number;
          const cz = b.path.z[q] as number;
          const dx = b.path.x[q + 1] as number;
          const dz = b.path.z[q + 1] as number;
          if (Math.max(cx, dx) < sminX || Math.min(cx, dx) > smaxX || Math.max(cz, dz) < sminZ || Math.min(cz, dz) > smaxZ) continue;
          const rx = bx - ax;
          const rz = bz - az;
          const sx = dx - cx;
          const sz = dz - cz;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((cx - ax) * sz - (cz - az) * sx) / den;
          const u = ((cx - ax) * rz - (cz - az) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const h = Math.max(a.hw[i] as number, b.hw[q] as number);
          raw.push({ x: ax + rx * t, z: az + rz * t, r: h + junctionClearing, w: 1 });
        }
      }
    }
  }
  // merge junctions that overlap (deterministic: insertion order)
  const merged: J[] = [];
  for (const j of raw) {
    let into: J | null = null;
    for (const m of merged) {
      const dx = m.x - j.x;
      const dz = m.z - j.z;
      if (dx * dx + dz * dz < Math.max(m.r, j.r) * Math.max(m.r, j.r)) {
        into = m;
        break;
      }
    }
    if (into) {
      const w = into.w + j.w;
      into.x = (into.x * into.w + j.x * j.w) / w;
      into.z = (into.z * into.w + j.z * j.w) / w;
      into.r = Math.max(into.r, j.r);
      into.w = w;
    } else merged.push({ ...j });
  }
  const clearings: RoadClearing[] = merged.map((m) => ({ x: m.x, z: m.z, r: m.r, kind: 'junction' as const }));
  built.forEach((a, k) => {
    for (const e of [0, 1]) {
      const rad = a.ends[e] as number;
      if (rad <= 0 || connected[k * 2 + e]) continue;
      const i = e === 0 ? 0 : a.path.n - 1;
      const ex = a.path.x[i] as number;
      const ez = a.path.z[i] as number;
      // a dead end sitting inside a junction clearing is not a dead end
      if (merged.some((m) => (m.x - ex) * (m.x - ex) + (m.z - ez) * (m.z - ez) < m.r * m.r)) continue;
      clearings.push({ x: ex, z: ez, r: rad, kind: 'end' });
    }
  });

  // ---- 3. spatial hash over every segment (capsule with linear half width) and clearing disc --------------------------
  let hwMax = 0;
  let benchMax = 0;
  let segCount = 0;
  for (const b of built) {
    hwMax = Math.max(hwMax, b.hwMax);
    if (b.graded) benchMax = Math.max(benchMax, b.bench);
    segCount += Math.max(0, b.path.n - 1);
  }
  const reg = reach + hwMax + edgeNoise + benchMax + soft;
  // segment record: ax az bx bz hwa hwb road s0 s1 graded ga gb bench  (13 floats)
  const SEG = 13;
  const seg = new Float64Array(segCount * SEG);
  let o = 0;
  let minX = 1e18;
  let maxX = -1e18;
  let minZ = 1e18;
  let maxZ = -1e18;
  built.forEach((b, k) => {
    const p = b.path;
    for (let i = 0; i < p.n - 1; i++) {
      const s0 = p.s[i] as number;
      const s1 = p.s[i + 1] as number;
      const f0 = p.total > 0 ? s0 / p.total : 0;
      const f1 = p.total > 0 ? s1 / p.total : 0;
      seg[o] = p.x[i] as number;
      seg[o + 1] = p.z[i] as number;
      seg[o + 2] = p.x[i + 1] as number;
      seg[o + 3] = p.z[i + 1] as number;
      seg[o + 4] = b.hw[i] as number;
      seg[o + 5] = b.hw[i + 1] as number;
      seg[o + 6] = k;
      seg[o + 7] = s0;
      seg[o + 8] = s1;
      seg[o + 9] = b.graded ? 1 : 0;
      seg[o + 10] = b.g0 + (b.g1 - b.g0) * f0;
      seg[o + 11] = b.g0 + (b.g1 - b.g0) * f1;
      seg[o + 12] = b.bench;
      o += SEG;
    }
    minX = Math.min(minX, p.minX);
    maxX = Math.max(maxX, p.maxX);
    minZ = Math.min(minZ, p.minZ);
    maxZ = Math.max(maxZ, p.maxZ);
  });
  for (const c of clearings) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minZ = Math.min(minZ, c.z - c.r);
    maxZ = Math.max(maxZ, c.z + c.r);
  }
  const gx0 = minX - reg;
  const gz0 = minZ - reg;
  const gnx = segCount + clearings.length > 0 ? Math.max(1, Math.ceil((maxX + reg - gx0) / CELL)) : 0;
  const gnz = segCount + clearings.length > 0 ? Math.max(1, Math.ceil((maxZ + reg - gz0) / CELL)) : 0;
  const cellOf = (v: number, v0: number, nn: number): number => {
    const i = Math.floor((v - v0) / CELL);
    return i < 0 ? 0 : i >= nn ? nn - 1 : i;
  };
  // items: segment index (0..segCount-1) or segCount + clearing index
  const counts = new Int32Array(gnx * gnz + 1);
  const each = (fn: (item: number, x0: number, z0: number, x1: number, z1: number) => void): void => {
    for (let q = 0; q < segCount; q++) {
      const b = q * SEG;
      const ax = seg[b] as number;
      const az = seg[b + 1] as number;
      const bx = seg[b + 2] as number;
      const bz = seg[b + 3] as number;
      fn(q, Math.min(ax, bx) - reg, Math.min(az, bz) - reg, Math.max(ax, bx) + reg, Math.max(az, bz) + reg);
    }
    clearings.forEach((c, q) => fn(segCount + q, c.x - c.r - reg, c.z - c.r - reg, c.x + c.r + reg, c.z + c.r + reg));
  };
  each((_item, x0, z0, x1, z1) => {
    const i0 = cellOf(x0, gx0, gnx);
    const i1 = cellOf(x1, gx0, gnx);
    const j0 = cellOf(z0, gz0, gnz);
    const j1 = cellOf(z1, gz0, gnz);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * gnx + i + 1] = (counts[j * gnx + i + 1] as number) + 1;
  });
  for (let c = 0; c < gnx * gnz; c++) counts[c + 1] = (counts[c + 1] as number) + (counts[c] as number);
  const items = new Int32Array(counts[gnx * gnz] as number);
  const fill = counts.slice(0, gnx * gnz);
  each((item, x0, z0, x1, z1) => {
    const i0 = cellOf(x0, gx0, gnx);
    const i1 = cellOf(x1, gx0, gnx);
    const j0 = cellOf(z0, gz0, gnz);
    const j1 = cellOf(z1, gz0, gnz);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * gnx + i;
        items[fill[c] as number] = item;
        fill[c] = (fill[c] as number) + 1;
      }
    }
  });
  const cx = new Float64Array(clearings.length);
  const cz = new Float64Array(clearings.length);
  const cr = new Float64Array(clearings.length);
  clearings.forEach((c, q) => {
    cx[q] = c.x;
    cz[q] = c.z;
    cr[q] = c.r;
  });
  // per cell, items sorted by a lower bound of their edge distance from anywhere in the cell, so a query stops as soon
  // as no later item can change the answer (typically a handful of segments instead of every one within reach)
  const lbs = new Float64Array(items.length);
  const hd = CELL * 0.7071067811865476;
  const order: Array<[number, number]> = [];
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const c = j * gnx + i;
      const k0 = counts[c] as number;
      const k1 = counts[c + 1] as number;
      if (k1 <= k0) continue;
      const px = gx0 + (i + 0.5) * CELL;
      const pz = gz0 + (j + 0.5) * CELL;
      order.length = 0;
      for (let k = k0; k < k1; k++) {
        const it = items[k] as number;
        let lb: number;
        if (it < segCount) {
          const b = it * SEG;
          const ax = seg[b] as number;
          const az = seg[b + 1] as number;
          const dx = (seg[b + 2] as number) - ax;
          const dz = (seg[b + 3] as number) - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - px;
          const qz = az + dz * t - pz;
          lb = Math.sqrt(qx * qx + qz * qz) - hd - Math.max(seg[b + 4] as number, seg[b + 5] as number);
        } else {
          const q = it - segCount;
          const dx = px - (cx[q] as number);
          const dz = pz - (cz[q] as number);
          lb = Math.sqrt(dx * dx + dz * dz) - hd - (cr[q] as number);
        }
        order.push([lb, it]);
      }
      order.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (let k = k0; k < k1; k++) {
        const e = order[k - k0] as [number, number];
        lbs[k] = e[0];
        items[k] = e[1];
      }
    }
  }
  const gxMax = gx0 + gnx * CELL;
  const gzMax = gz0 + gnz * CELL;
  // beyond `band` m from every edge all weights are 0 (the last 1.5 m fade the edge noise out)
  const band = wearW + fringeW + 2 * soft + edgeNoise + 1.5;
  // a clearing still weighs in up to this edge distance; a graded segment adds bench weight up to its bench width
  const clearLim = soft + edgeNoise;
  const benchLim = benchMax > 0 ? benchMax : -1e9;

  const sample = (x: number, z: number, out: RoadSample): RoadSample => {
    let dT = 1e9;
    let dC = 1e9;
    let W = 0;
    let G = 0;
    let wmax = 0;
    if (gnx > 0 && x >= gx0 && x < gxMax && z >= gz0 && z < gzMax) {
      const c = Math.floor((z - gz0) / CELL) * gnx + Math.floor((x - gx0) / CELL);
      const e = counts[c + 1] as number;
      for (let k = counts[c] as number; k < e; k++) {
        const lb = lbs[k] as number;
        const dMin = dT < dC ? dT : dC;
        const need = dMin < reach ? dMin : reach;
        if (lb > (need > clearLim ? need : clearLim) && lb >= benchLim) break;
        const it = items[k] as number;
        if (it < segCount) {
          const b = it * SEG;
          const ax = seg[b] as number;
          const az = seg[b + 1] as number;
          const dx = (seg[b + 2] as number) - ax;
          const dz = (seg[b + 3] as number) - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - x;
          const qz = az + dz * t - z;
          const dist = Math.sqrt(qx * qx + qz * qz);
          const hw = (seg[b + 4] as number) + ((seg[b + 5] as number) - (seg[b + 4] as number)) * t;
          const ed = dist - hw;
          if (ed < dT) dT = ed;
          if (seg[b + 9] === 1) {
            const bench = seg[b + 12] as number;
            const wb = 1 - smoothstep(hw + bench * 0.35, hw + bench, dist);
            if (wb > 0) {
              W += wb;
              G += wb * ((seg[b + 10] as number) + ((seg[b + 11] as number) - (seg[b + 10] as number)) * t);
              if (wb > wmax) wmax = wb;
            }
          }
        } else {
          const q = it - segCount;
          const dx = x - (cx[q] as number);
          const dz = z - (cz[q] as number);
          const ed = Math.sqrt(dx * dx + dz * dz) - (cr[q] as number);
          if (ed < dC) dC = ed;
        }
      }
    }
    out.grade = W > 0 ? G / W : 0;
    out.bench = wmax;
    const d0 = dT < dC ? dT : dC;
    if (d0 > band) {
      out.road = 0;
      out.wear = 0;
      out.fringe = 0;
      out.clearing = 0;
      out.d = d0 < reach ? d0 : reach;
      return out;
    }
    // edge wobble, faded out towards the band limit so `d` stays continuous where the noise stops being evaluated
    const n = edgeNoise > 0 ? edgeNoise * clamp(2.2 * fbm(x / 6.5, z / 6.5, noiseSeed, 2), -1, 1) * (1 - smoothstep(band - 1.5, band, d0)) : 0;
    const dn = d0 + n;
    out.road = 1 - smoothstep(-soft, soft, dn);
    out.clearing = dC < 1e8 ? 1 - smoothstep(-soft, soft, dC + n) : 0;
    const outside = smoothstep(-soft, soft, dn);
    out.wear = wearW > 0 ? outside * (1 - smoothstep(wearW - soft, wearW + soft, dn)) : 0;
    out.fringe = fringeW > 0 ? smoothstep(wearW - soft, wearW + soft, dn) * (1 - smoothstep(wearW + fringeW - soft, wearW + fringeW + 2 * soft, dn)) : 0;
    out.d = dn < reach ? dn : reach;
    return out;
  };

  const distance = (x: number, z: number): number => {
    let best = reg;
    if (gnx > 0 && x >= gx0 && x < gxMax && z >= gz0 && z < gzMax) {
      const c = Math.floor((z - gz0) / CELL) * gnx + Math.floor((x - gx0) / CELL);
      const e = counts[c + 1] as number;
      for (let k = counts[c] as number; k < e; k++) {
        // centre distance ≥ edge lower bound: nothing later can beat `best`
        if ((lbs[k] as number) > best) break;
        const it = items[k] as number;
        if (it >= segCount) continue;
        const b = it * SEG;
        const ax = seg[b] as number;
        const az = seg[b + 1] as number;
        const dx = (seg[b + 2] as number) - ax;
        const dz = (seg[b + 3] as number) - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - x;
        const qz = az + dz * t - z;
        const dist = Math.sqrt(qx * qx + qz * qz);
        if (dist < best) best = dist;
      }
    }
    return best;
  };

  const pointAt = (road: number, s: number, out: RoadPoint): RoadPoint => {
    const b = built[road];
    if (!b) throw new Error(`world/kit roadNetwork: no road ${road}`);
    b.path.at(s, out);
    out.hw = b.path.lerpAt(b.hw, s);
    return out;
  };

  return {
    centres: built.map((b) => b.path.points()),
    junctions: merged.map((m): Vec2 => [m.x, m.z]),
    lengths: built.map((b) => b.path.total),
    clearings,
    reach,
    sample,
    distance,
    pointAt,
    along(road, s, offset, out) {
      pointAt(road, s, out);
      out.x += out.tz * offset;
      out.z -= out.tx * offset;
      return out;
    },
    lanes(extra = 2) {
      return built.map((b) => ({ pts: b.path.points(), half: b.hwMax + extra }));
    },
  };
}

/**
 * Control points of a switchback track from `a` to `b` (zig-zag legs of `legWidth` m across the slope), for a RoadSpec.
 * `legs` = straight traverses (legs − 1 hairpins, alternating sides); `turn` = hairpin length along the slope (m).
 * Use it with a small `wander` (about 1) and `grade: [h(a), h(b)]` to cut a walkable bench into a steep riser.
 */
export function switchback(a: Vec2, b: Vec2, opts: { legs: number; legWidth: number; seed: number; turn?: number }): Vec2[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.sqrt(dx * dx + dz * dz);
  if (L < 1e-6) return [[a[0], a[1]], [b[0], b[1]]];
  const ux = dx / L;
  const uz = dz / L;
  const px = -uz;
  const pz = ux;
  const legs = Math.max(1, Math.floor(opts.legs));
  const legLen = L / legs;
  const half = Math.max(0, opts.legWidth) * 0.5;
  const turn = opts.turn ?? Math.min(legLen * 0.3, opts.legWidth * 0.2, 6);
  const rng = new WorldRng(subSeed(opts.seed, 0x5b17));
  let side = rng.next() < 0.5 ? 1 : -1;
  const pts: Vec2[] = [[a[0], a[1]]];
  for (let i = 1; i < legs; i++) {
    const along = legLen * i + (rng.next() - 0.5) * legLen * 0.2;
    const w = half * (0.85 + 0.3 * rng.next());
    const hx = a[0] + ux * along + px * side * w;
    const hz = a[1] + uz * along + pz * side * w;
    // a hairpin = two control points on the same side, `turn` m apart along the slope
    pts.push([hx - ux * turn * 0.5, hz - uz * turn * 0.5]);
    pts.push([hx + ux * turn * 0.5, hz + uz * turn * 0.5]);
    side = -side;
  }
  pts.push([b[0], b[1]]);
  return pts;
}
