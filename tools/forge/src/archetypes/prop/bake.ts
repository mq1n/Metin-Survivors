// Prop bake: xatlas unwrap -> per-texel rasterisation -> ray-cast AO (short contact + long sky) -> material shading -> gutter
// dilation. The vertex stack gets the long-range sky occlusion in COLOR_0 (multiplied with the albedo by the game material).
import type { Vec3 } from '../../core/math.ts';
import { clamp01, vcross } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { linearToSrgb } from '../../core/paint/painter.ts';
import { Bvh } from './bvh.ts';
import type { Finished, Mat, Texel, Vec2 } from './mesh.ts';
import { type Rgb, type Tex, sampleTex } from './texlib.ts';
import { PROP_TEX_MAX } from './texCap.ts';

export interface BakeOpts {
  /** target atlas edge in texels */
  size: number;
  /** longest-edge cap of the atlas (px); default PROP_TEX_MAX, `propTexMax(id)` of texCap.ts gives a landmark more */
  max?: number;
  seed: string | number;
  mats: Mat[];
  /** rays per texel */
  rays?: number;
  /** short (contact) and long (sky) occlusion distances in metres */
  aoShort?: number;
  aoLong?: number;
  /** shadow tint multiplied in at full occlusion (cool-ish so crevices do not go grey-brown mud) */
  shadowTint?: Rgb;
  /** exponent applied to the combined occlusion factor before it blends towards shadowTint (>1 = deeper, wider crevice/eave shadows) */
  aoGain?: number;
  /** linear multiplier applied to every emissive texel before 8-bit encoding (lets a >1 intensity live in the map, since glTF caps emissiveFactor at 1) */
  emissiveGain?: number;
  log?: (s: string) => void;
}

export interface Baked {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  albedo: { rgba: Uint8Array; w: number; h: number };
  emissive?: { rgba: Uint8Array; w: number; h: number };
  atlas: { w: number; h: number };
}

class TexelCtx implements Texel {
  p: Vec3 = [0, 0, 0];
  n: Vec3 = [0, 1, 0];
  nf: Vec3 = [0, 1, 0];
  uv: Vec2 = [0, 0];
  mpt = 0.03;
  tpm = 1;
  fp = 0.03;
  hy = 0;
  ao = 1;
  aoL = 1;
  edge = 0;
  constructor(readonly noise: Noise) {}
  tex(t: Tex, k = 1, du = 0, dv = 0): Rgb {
    return sampleTex(t, this.uv[0] * k + du, this.uv[1] * k + dv, this.fp * k);
  }
}

/** Hammersley point -> cosine-weighted hemisphere (local z up) */
function hemisphere(i: number, n: number, rot: number, out: Vec3): void {
  let bits = i;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  const v = bits * 2.3283064365386963e-10;
  const phi = ((i + 0.5) / n + rot) * Math.PI * 2;
  const r = Math.sqrt(v);
  out[0] = r * Math.cos(phi);
  out[1] = r * Math.sin(phi);
  out[2] = Math.sqrt(1 - v);
}

/** (occ short, occ long) fractions in 0..1 for a point with frame normal n */
function occlusion(bvh: Bvh, p: Vec3, n: Vec3, nf: Vec3, rays: number, rot: number, rs: number, rl: number, out: [number, number]): void {
  // tangent frame
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tx = vcross(ref, n);
  const tl = Math.hypot(tx[0], tx[1], tx[2]) || 1;
  tx[0] /= tl; tx[1] /= tl; tx[2] /= tl;
  const ty = vcross(n, tx);
  const ox = p[0] + nf[0] * 0.01, oy = p[1] + nf[1] * 0.01, oz = p[2] + nf[2] * 0.01;
  const h: Vec3 = [0, 0, 0];
  let os = 0, ol = 0;
  for (let i = 0; i < rays; i++) {
    hemisphere(i, rays, rot, h);
    const dx = tx[0] * h[0] + ty[0] * h[1] + n[0] * h[2];
    const dy = tx[1] * h[0] + ty[1] * h[1] + n[1] * h[2];
    const dz = tx[2] * h[0] + ty[2] * h[1] + n[2] * h[2];
    const t = bvh.hit(ox, oy, oz, dx, dy, dz, rl);
    if (t === Infinity) continue;
    ol += 1;
    if (t < rs) os += 1 - t / rs;
  }
  out[0] = os / rays;
  out[1] = ol / rays;
}

const hash2 = (x: number, y: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export async function bakeProp(fin: Finished, o: BakeOpts): Promise<Baked> {
  const log = o.log ?? (() => {});
  // payload policy (texCap.ts): a prop atlas never exceeds propTexMax(id) px (PROP_TEX_MAX, LANDMARK_TEX_MAX for a landmark),
  // whatever the model asks for; the unwrap is re-packed until its longest edge fits (below the cap the old 15 % slack stays)
  const cap = o.max ?? PROP_TEX_MAX;
  const S = Math.min(o.size, cap);
  const fit = Math.min(S * 1.15, cap);
  // ---- unwrap
  let area = 0;
  const nt0 = fin.indices.length / 3;
  for (let t = 0; t < nt0; t++) {
    const a = fin.indices[t * 3]! * 3, b = fin.indices[t * 3 + 1]! * 3, c = fin.indices[t * 3 + 2]! * 3;
    const cr = vcross(
      [fin.positions[b]! - fin.positions[a]!, fin.positions[b + 1]! - fin.positions[a + 1]!, fin.positions[b + 2]! - fin.positions[a + 2]!],
      [fin.positions[c]! - fin.positions[a]!, fin.positions[c + 1]! - fin.positions[a + 1]!, fin.positions[c + 2]! - fin.positions[a + 2]!],
    );
    area += 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
  }
  let tpu = Math.sqrt((0.55 * S * S) / area);
  let atlas = await unwrap(fin.positions, fin.indices, { texelsPerUnit: tpu, padding: 3, maxCost: 4 });
  for (let tries = 0; tries < 4 && Math.max(atlas.width, atlas.height) > fit; tries++) {
    tpu *= (S / Math.max(atlas.width, atlas.height)) * 0.97;
    atlas = await unwrap(fin.positions, fin.indices, { texelsPerUnit: tpu, padding: 3, maxCost: 4 });
  }
  const W = atlas.width, H = atlas.height;
  if (Math.max(W, H) > cap) log(`  WARNING: atlas ${W}x${H} exceeds the ${cap} px prop cap; run tools/forge/scripts/propTex.ts on the shipped GLB`);
  const nv = atlas.positions.length / 3;
  log(`  unwrapped: ${nv} verts, atlas ${W}x${H}, ${tpu.toFixed(1)} texels/m`);
  const pos = atlas.positions;
  const idx = atlas.indices;
  const nrm = new Float32Array(nv * 3);
  const tuv = new Float32Array(nv * 2);
  const grp = new Uint16Array(nv);
  for (let v = 0; v < nv; v++) {
    const s = atlas.oldIndex[v]!;
    nrm[v * 3] = fin.normals[s * 3]!; nrm[v * 3 + 1] = fin.normals[s * 3 + 1]!; nrm[v * 3 + 2] = fin.normals[s * 3 + 2]!;
    tuv[v * 2] = fin.tuv[s * 2]!; tuv[v * 2 + 1] = fin.tuv[s * 2 + 1]!;
    grp[v] = fin.groups[s]!;
  }
  const nt = idx.length / 3;
  // the ground (y = 0) is part of the occlusion scene so wall bases darken like they do against the terrain
  let ext = 1;
  for (let v = 0; v < nv; v++) ext = Math.max(ext, Math.abs(pos[v * 3]!), Math.abs(pos[v * 3 + 2]!), pos[v * 3 + 1]!);
  ext *= 3;
  const bpos = new Float32Array(pos.length + 12);
  bpos.set(pos);
  bpos.set([-ext, 0, -ext, ext, 0, -ext, ext, 0, ext, -ext, 0, ext], pos.length);
  const bidx = new Uint32Array(idx.length + 6);
  bidx.set(idx);
  bidx.set([nv, nv + 2, nv + 1, nv, nv + 3, nv + 2], idx.length);
  const bvh = new Bvh(bpos, bidx);
  const aoS = o.aoShort ?? 0.45, aoLg = o.aoLong ?? 3;
  const rays = o.rays ?? 14;

  // ---- vertex colours: sky occlusion
  const colors = new Float32Array(nv * 3);
  {
    const occ: [number, number] = [0, 0];
    const p: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
    for (let v = 0; v < nv; v++) {
      p[0] = pos[v * 3]!; p[1] = pos[v * 3 + 1]!; p[2] = pos[v * 3 + 2]!;
      n[0] = nrm[v * 3]!; n[1] = nrm[v * 3 + 1]!; n[2] = nrm[v * 3 + 2]!;
      occlusion(bvh, p, n, n, 40, hash2(v, 7), aoS, aoLg, occ);
      const k = 0.84 + 0.16 * (1 - occ[1]) ** 1.5;
      colors[v * 3] = k; colors[v * 3 + 1] = k * 0.985; colors[v * 3 + 2] = k * 1.02;
    }
  }

  // ---- raster: best triangle + barycentrics per texel
  const N = W * H;
  const triOf = new Int32Array(N).fill(-1);
  const score = new Float32Array(N).fill(-1e9);
  const bary = new Float32Array(N * 3);
  const mptT = new Float32Array(nt), tpmT = new Float32Array(nt);
  const uvs = atlas.uvs;
  for (let t = 0; t < nt; t++) {
    const i0 = idx[t * 3]!, i1 = idx[t * 3 + 1]!, i2 = idx[t * 3 + 2]!;
    const x0 = uvs[i0 * 2]! * W, y0 = uvs[i0 * 2 + 1]! * H, x1 = uvs[i1 * 2]! * W, y1 = uvs[i1 * 2 + 1]! * H, x2 = uvs[i2 * 2]! * W, y2 = uvs[i2 * 2 + 1]! * H;
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const wa = vcross(
      [pos[i1 * 3]! - pos[i0 * 3]!, pos[i1 * 3 + 1]! - pos[i0 * 3 + 1]!, pos[i1 * 3 + 2]! - pos[i0 * 3 + 2]!],
      [pos[i2 * 3]! - pos[i0 * 3]!, pos[i2 * 3 + 1]! - pos[i0 * 3 + 1]!, pos[i2 * 3 + 2]! - pos[i0 * 3 + 2]!],
    );
    const worldA = 0.5 * Math.hypot(wa[0], wa[1], wa[2]);
    const texA = 0.5 * Math.abs(det);
    mptT[t] = texA > 1e-9 ? Math.sqrt(worldA / texA) : 0.03;
    const ta = 0.5 * Math.abs((tuv[i1 * 2]! - tuv[i0 * 2]!) * (tuv[i2 * 2 + 1]! - tuv[i0 * 2 + 1]!) - (tuv[i2 * 2]! - tuv[i0 * 2]!) * (tuv[i1 * 2 + 1]! - tuv[i0 * 2 + 1]!));
    tpmT[t] = worldA > 1e-12 ? Math.sqrt(ta / worldA) : 1;
    if (Math.abs(det) < 1e-9) continue;
    const e0 = Math.hypot(x2 - x1, y2 - y1), e1 = Math.hypot(x0 - x2, y0 - y2), e2 = Math.hypot(x1 - x0, y1 - y0);
    const h0 = Math.abs(det) / (e0 || 1), h1 = Math.abs(det) / (e1 || 1), h2 = Math.abs(det) / (e2 || 1);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 2)), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2) + 2));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 2)), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2) + 2));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const b1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / det;
        const b2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / det;
        const b0 = 1 - b1 - b2;
        const d = Math.min(b0 * h0, b1 * h1, b2 * h2);
        if (d < -1.3) continue;
        const k = y * W + x;
        if (d > score[k]!) {
          score[k] = d;
          triOf[k] = t;
          bary[k * 3] = b0; bary[k * 3 + 1] = b1; bary[k * 3 + 2] = b2;
        }
      }
    }
  }

  // ---- per-texel geometry
  const P = new Float32Array(N * 3), Nn = new Float32Array(N * 3), Nf = new Float32Array(N * 3), U = new Float32Array(N * 2);
  const aoS_ = new Float32Array(N).fill(1), aoL_ = new Float32Array(N).fill(1), edge_ = new Float32Array(N);
  let covered = 0;
  for (let k = 0; k < N; k++) {
    const t = triOf[k]!;
    if (t < 0) continue;
    covered++;
    const i0 = idx[t * 3]!, i1 = idx[t * 3 + 1]!, i2 = idx[t * 3 + 2]!;
    const b0 = bary[k * 3]!, b1 = bary[k * 3 + 1]!, b2 = bary[k * 3 + 2]!;
    for (let c = 0; c < 3; c++) {
      P[k * 3 + c] = pos[i0 * 3 + c]! * b0 + pos[i1 * 3 + c]! * b1 + pos[i2 * 3 + c]! * b2;
      Nn[k * 3 + c] = nrm[i0 * 3 + c]! * b0 + nrm[i1 * 3 + c]! * b1 + nrm[i2 * 3 + c]! * b2;
    }
    const l = Math.hypot(Nn[k * 3]!, Nn[k * 3 + 1]!, Nn[k * 3 + 2]!) || 1;
    Nn[k * 3] = Nn[k * 3]! / l; Nn[k * 3 + 1] = Nn[k * 3 + 1]! / l; Nn[k * 3 + 2] = Nn[k * 3 + 2]! / l;
    const fnv = vcross(
      [pos[i1 * 3]! - pos[i0 * 3]!, pos[i1 * 3 + 1]! - pos[i0 * 3 + 1]!, pos[i1 * 3 + 2]! - pos[i0 * 3 + 2]!],
      [pos[i2 * 3]! - pos[i0 * 3]!, pos[i2 * 3 + 1]! - pos[i0 * 3 + 1]!, pos[i2 * 3 + 2]! - pos[i0 * 3 + 2]!],
    );
    const fl = Math.hypot(fnv[0], fnv[1], fnv[2]) || 1;
    Nf[k * 3] = fnv[0] / fl; Nf[k * 3 + 1] = fnv[1] / fl; Nf[k * 3 + 2] = fnv[2] / fl;
    U[k * 2] = tuv[i0 * 2]! * b0 + tuv[i1 * 2]! * b1 + tuv[i2 * 2]! * b2;
    U[k * 2 + 1] = tuv[i0 * 2 + 1]! * b0 + tuv[i1 * 2 + 1]! * b1 + tuv[i2 * 2 + 1]! * b2;
    edge_[k] = clamp01((1 - (Nn[k * 3]! * Nf[k * 3]! + Nn[k * 3 + 1]! * Nf[k * 3 + 1]! + Nn[k * 3 + 2]! * Nf[k * 3 + 2]!)) * 6);
  }
  log(`  raster: ${covered}/${N} texels (${Math.round((covered / N) * 100)}%)`);

  // ---- AO per texel
  {
    const occ: [number, number] = [0, 0];
    const p: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0], nf: Vec3 = [0, 0, 0];
    for (let k = 0; k < N; k++) {
      if (triOf[k]! < 0) continue;
      p[0] = P[k * 3]!; p[1] = P[k * 3 + 1]!; p[2] = P[k * 3 + 2]!;
      n[0] = Nn[k * 3]!; n[1] = Nn[k * 3 + 1]!; n[2] = Nn[k * 3 + 2]!;
      nf[0] = Nf[k * 3]!; nf[1] = Nf[k * 3 + 1]!; nf[2] = Nf[k * 3 + 2]!;
      occlusion(bvh, p, n, nf, rays, hash2(k % W, (k / W) | 0), aoS, aoLg, occ);
      aoS_[k] = 1 - occ[0];
      aoL_[k] = 1 - occ[1];
    }
    // 3x3 blur over covered texels (hides the ray noise; gutters keep their own values)
    for (const buf of [aoS_, aoL_]) {
      const src = Float32Array.from(buf);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = y * W + x;
          if (triOf[k]! < 0) continue;
          let sum = 0, wsum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const kk = yy * W + xx;
              if (triOf[kk]! < 0 || Math.abs(Nn[kk * 3]! * Nn[k * 3]! + Nn[kk * 3 + 1]! * Nn[k * 3 + 1]! + Nn[kk * 3 + 2]! * Nn[k * 3 + 2]! - 1) > 0.25) continue;
              const w = dx === 0 && dy === 0 ? 2 : 1;
              sum += src[kk]! * w;
              wsum += w;
            }
          }
          buf[k] = sum / wsum;
        }
      }
    }
  }
  log('  ao done');

  // ---- shade
  const noise = new Noise(o.seed);
  const ctx = new TexelCtx(noise);
  const tint = o.shadowTint ?? [0.68, 0.6, 0.6];
  const gain = o.aoGain ?? 1;
  const rgba = new Uint8Array(N * 4);
  const hasEmit = o.mats.some((m) => m.emit);
  const erg = hasEmit ? new Uint8Array(N * 4) : null;
  const eGain = o.emissiveGain ?? 1;
  const filled = new Uint8Array(N);
  const enc = (c: number): number => Math.round(clamp01(linearToSrgb(clamp01(c))) * 255);
  for (let k = 0; k < N; k++) {
    const t = triOf[k]!;
    if (t < 0) continue;
    const i0 = idx[t * 3]!;
    const mat = o.mats[grp[i0]!] ?? o.mats[0]!;
    ctx.p[0] = P[k * 3]!; ctx.p[1] = P[k * 3 + 1]!; ctx.p[2] = P[k * 3 + 2]!;
    ctx.n[0] = Nn[k * 3]!; ctx.n[1] = Nn[k * 3 + 1]!; ctx.n[2] = Nn[k * 3 + 2]!;
    ctx.nf[0] = Nf[k * 3]!; ctx.nf[1] = Nf[k * 3 + 1]!; ctx.nf[2] = Nf[k * 3 + 2]!;
    ctx.uv[0] = U[k * 2]!; ctx.uv[1] = U[k * 2 + 1]!;
    ctx.mpt = mptT[t]!; ctx.tpm = tpmT[t]!; ctx.fp = mptT[t]! * tpmT[t]!;
    ctx.hy = ctx.p[1];
    ctx.ao = aoS_[k]!; ctx.aoL = aoL_[k]!; ctx.edge = edge_[k]!;
    const c = mat.shade(ctx);
    const ka = mat.ao ?? 1;
    const f = ((1 - (1 - ctx.ao) * 0.75 * ka) * (1 - (1 - ctx.aoL) * 0.55 * ka)) ** gain;
    for (let ch = 0; ch < 3; ch++) rgba[k * 4 + ch] = enc(c[ch]! * (tint[ch]! + (1 - tint[ch]!) * f));
    rgba[k * 4 + 3] = 255;
    if (erg) {
      const e = mat.emit?.(ctx);
      if (e) for (let ch = 0; ch < 3; ch++) erg[k * 4 + ch] = enc(e[ch]! * eGain);
      erg[k * 4 + 3] = 255;
    }
    filled[k] = 1;
  }
  // ---- dilate gutters
  for (let pass = 0; pass < 6; pass++) {
    const add: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (filled[k]) continue;
        let r = 0, g = 0, b = 0, er = 0, eg = 0, eb = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const kk = yy * W + xx;
            if (!filled[kk]) continue;
            r += rgba[kk * 4]!; g += rgba[kk * 4 + 1]!; b += rgba[kk * 4 + 2]!;
            if (erg) { er += erg[kk * 4]!; eg += erg[kk * 4 + 1]!; eb += erg[kk * 4 + 2]!; }
            c++;
          }
        }
        if (c === 0) continue;
        rgba[k * 4] = r / c; rgba[k * 4 + 1] = g / c; rgba[k * 4 + 2] = b / c; rgba[k * 4 + 3] = 255;
        if (erg) { erg[k * 4] = er / c; erg[k * 4 + 1] = eg / c; erg[k * 4 + 2] = eb / c; erg[k * 4 + 3] = 255; }
        add.push(k);
      }
    }
    for (const k of add) filled[k] = 1;
  }
  for (let k = 0; k < N; k++) if (!filled[k]) { rgba[k * 4] = 90; rgba[k * 4 + 1] = 80; rgba[k * 4 + 2] = 70; rgba[k * 4 + 3] = 255; }

  return {
    positions: pos, normals: nrm, uvs, indices: idx, colors,
    albedo: { rgba, w: W, h: H },
    ...(erg ? { emissive: { rgba: erg, w: W, h: H } } : {}),
    atlas: { w: W, h: H },
  };
}

/** Vertex-color shading path for props when textures are explicitly disabled (`--tex=0`): skips UV unwrap and texture rasterization. */
export function paintPropVertices(
  fin: Finished,
  o: Pick<BakeOpts, 'seed' | 'mats' | 'rays' | 'aoShort' | 'aoLong' | 'shadowTint' | 'aoGain'>,
): Float32Array {
  const { positions: pos, normals: nrm, tuv, groups: grp, indices: idx } = fin;
  const nv = pos.length / 3;
  const colors = new Float32Array(nv * 3);
  const bvh = new Bvh(pos, idx);
  const rays = o.rays ?? 12;
  const aoS = o.aoShort ?? 0.35;
  const aoLg = o.aoLong ?? 2.0;
  const tint = o.shadowTint ?? [0.68, 0.6, 0.6];
  const gain = o.aoGain ?? 1;
  const noise = new Noise(o.seed);
  const ctx = new TexelCtx(noise);
  const occ: [number, number] = [0, 0];
  for (let v = 0; v < nv; v++) {
    ctx.p[0] = pos[v * 3]!; ctx.p[1] = pos[v * 3 + 1]!; ctx.p[2] = pos[v * 3 + 2]!;
    ctx.n[0] = nrm[v * 3]!; ctx.n[1] = nrm[v * 3 + 1]!; ctx.n[2] = nrm[v * 3 + 2]!;
    ctx.nf[0] = ctx.n[0]; ctx.nf[1] = ctx.n[1]; ctx.nf[2] = ctx.n[2];
    ctx.uv[0] = tuv[v * 2]!; ctx.uv[1] = tuv[v * 2 + 1]!;
    ctx.hy = ctx.p[1];
    occlusion(bvh, ctx.p, ctx.n, ctx.nf, rays, (v * 0.61803398875) % 1, aoS, aoLg, occ);
    ctx.ao = 1 - occ[0];
    ctx.aoL = 1 - occ[1];
    const mat = o.mats[grp[v]!] ?? o.mats[0]!;
    const c = mat.shade(ctx);
    const ka = mat.ao ?? 1;
    const f = ((1 - (1 - ctx.ao) * 0.75 * ka) * (1 - (1 - ctx.aoL) * 0.55 * ka)) ** gain;
    for (let ch = 0; ch < 3; ch++) {
      colors[v * 3 + ch] = clamp01(c[ch]! * (tint[ch]! + (1 - tint[ch]!) * f));
    }
  }
  return colors;
}
