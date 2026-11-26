// Weapon bake: HardMesh -> xatlas UVs -> per-texel 3-D procedural paint (albedo + optional emissive) -> WebP -> ModelData.
// Paint functions run on the CANONICAL frame position of every texel (so patterns are authored along the blade axis), the shipped
// mesh is then rotated into the hero hand frame (frame.ts). Seams are invisible because both sides of a seam evaluate the same 3-D field.
import type { HardModelMesh } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import { clamp01, vdot, vnorm } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import { Noise } from '../../core/noise.ts';
import { encodePng, encodeWebp } from '../../core/export/image.ts';
import { repoRoot } from '../../core/export/manifest.ts';
import { unwrap } from '../../core/mesh/atlas.ts';
import { layoutHash, loadPaintedTexture } from '../../core/paint/cache.ts';
import { type Rgb, linearToSrgb } from '../../core/paint/painter.ts';
import { type Hand, mapVec3, toHand } from './frame.ts';
import { type EdgeField, buildEdgeField } from './features.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PaintSample {
  /** canonical-frame position (m) */
  p: Vec3;
  n: Vec3;
  zone: number;
  /** 1 = open, 0 = occluded (interpolated vertex AO) */
  ao: number;
  noise: Noise;
  /** distance (m, capped at 4 mm) to the nearest convex / concave crease */
  cvx: number;
  ccv: number;
  /** texel footprint (m): mip selection for tile sampling */
  px: number;
}
export interface Painted { albedo: Rgb; emissive?: Rgb }
export type PaintFn = (s: PaintSample) => Painted;

export interface BakeSpec {
  id: string;
  kind?: ModelData['kind'];
  mesh: HardModelMesh;
  paint: PaintFn;
  /** square texture size (px) */
  size: number;
  /** emissive map size; 0/undefined = no emissive */
  emissiveSize?: number;
  seed: number | string;
  hand: Hand;
  /** AO strength 0..1 on COLOR_0 (default 0.65) */
  aoStrength?: number;
  quality?: number;
  material?: ModelData['material'];
  extras?: Record<string, unknown>;
  emissiveFactor?: [number, number, number];
  /** log */
  log?: (s: string) => void;
  /** skip the texture (vertex colours only, from zone mid colours) */
  noTexture?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// vertex AO by ray casting against the soup (short rays: local crevices only)

function vertexAo(positions: Float32Array, normals: Float32Array, indices: Uint32Array, rays: number, maxDist: number): Float32Array {
  const nt = indices.length / 3;
  const tri = new Float32Array(nt * 9);
  const bmin = new Float32Array(nt * 3), bmax = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]!;
      for (let c = 0; c < 3; c++) {
        const x = positions[v * 3 + c]!;
        tri[t * 9 + k * 3 + c] = x;
        bmin[t * 3 + c] = k === 0 ? x : Math.min(bmin[t * 3 + c]!, x);
        bmax[t * 3 + c] = k === 0 ? x : Math.max(bmax[t * 3 + c]!, x);
      }
    }
  }
  const nv = positions.length / 3;
  const ao = new Float32Array(nv).fill(1);
  // fixed cosine-weighted directions in a local frame (z = normal)
  const dirs: Vec3[] = [];
  for (let i = 0; i < rays; i++) {
    const u = (i + 0.5) / rays, a = i * 2.399963;
    const r = Math.sqrt(u);
    dirs.push([Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - u)]);
  }
  for (let v = 0; v < nv; v++) {
    const n: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
    const o: Vec3 = [positions[v * 3]! + n[0] * 0.0015, positions[v * 3 + 1]! + n[1] * 0.0015, positions[v * 3 + 2]! + n[2] * 0.0015];
    const t1 = vnorm(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]]);
    const t2: Vec3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    let hits = 0;
    for (const d of dirs) {
      const dx = t1[0] * d[0] + t2[0] * d[1] + n[0] * d[2], dy = t1[1] * d[0] + t2[1] * d[1] + n[1] * d[2], dz = t1[2] * d[0] + t2[2] * d[1] + n[2] * d[2];
      let hit = false;
      for (let t = 0; t < nt && !hit; t++) {
        // slab test against the triangle box (segment o .. o + d*maxDist)
        let t0 = 0, t1b = maxDist;
        const bo = t * 3;
        const ox = o[0], oy = o[1], oz = o[2];
        // x
        if (Math.abs(dx) < 1e-9) { if (ox < bmin[bo]! || ox > bmax[bo]!) continue; } else {
          let a = (bmin[bo]! - ox) / dx, b = (bmax[bo]! - ox) / dx;
          if (a > b) { const s = a; a = b; b = s; }
          if (a > t0) t0 = a;
          if (b < t1b) t1b = b;
          if (t0 > t1b) continue;
        }
        if (Math.abs(dy) < 1e-9) { if (oy < bmin[bo + 1]! || oy > bmax[bo + 1]!) continue; } else {
          let a = (bmin[bo + 1]! - oy) / dy, b = (bmax[bo + 1]! - oy) / dy;
          if (a > b) { const s = a; a = b; b = s; }
          if (a > t0) t0 = a;
          if (b < t1b) t1b = b;
          if (t0 > t1b) continue;
        }
        if (Math.abs(dz) < 1e-9) { if (oz < bmin[bo + 2]! || oz > bmax[bo + 2]!) continue; } else {
          let a = (bmin[bo + 2]! - oz) / dz, b = (bmax[bo + 2]! - oz) / dz;
          if (a > b) { const s = a; a = b; b = s; }
          if (a > t0) t0 = a;
          if (b < t1b) t1b = b;
          if (t0 > t1b) continue;
        }
        // Moller-Trumbore
        const b9 = t * 9;
        const e1x = tri[b9 + 3]! - tri[b9]!, e1y = tri[b9 + 4]! - tri[b9 + 1]!, e1z = tri[b9 + 5]! - tri[b9 + 2]!;
        const e2x = tri[b9 + 6]! - tri[b9]!, e2y = tri[b9 + 7]! - tri[b9 + 1]!, e2z = tri[b9 + 8]! - tri[b9 + 2]!;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - tri[b9]!, sy = oy - tri[b9 + 1]!, sz = oz - tri[b9 + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-5 && tt < maxDist) hit = true;
      }
      if (hit) hits++;
    }
    ao[v] = 1 - hits / rays;
  }
  return ao;
}

// ---------------------------------------------------------------------------------------------------------------------------------

interface Baked { rgba: Uint8Array }

export function bakeMaps(
  W: number,
  H: number,
  EW: number,
  EH: number,
  uv: Float32Array,
  idx: Uint32Array,
  pos: Float32Array,
  nrm: Float32Array,
  zone: Uint16Array,
  ao: Float32Array,
  paint: PaintFn,
  ef: EdgeField,
  seed: number | string,
  texelSize: number,
  log?: (s: string) => void,
): { albedo: Baked; emissive?: Baked } {
  const noise = new Noise(seed);
  const withEmissive = EW > 0 && EH > 0;
  const col = new Float32Array(W * H * 3);
  const em = withEmissive ? new Float32Array(EW * EH * 3) : null;
  const score = new Float32Array(W * H).fill(-1);
  const emScore = withEmissive ? new Float32Array(EW * EH).fill(-1) : null;
  const nTri = idx.length / 3;
  const pass = (w: number, h: number, scoreArr: Float32Array, samplePx: number, write: (o: number, r: Painted) => void): number => {
    let covered = 0;
    for (let t = 0; t < nTri; t++) {
      const ia = idx[t * 3]!, ib = idx[t * 3 + 1]!, ic = idx[t * 3 + 2]!;
      const ax = uv[ia * 2]! * w, ay = uv[ia * 2 + 1]! * h;
      const bx = uv[ib * 2]! * w, by = uv[ib * 2 + 1]! * h;
      const cx = uv[ic * 2]! * w, cy = uv[ic * 2 + 1]! * h;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 2), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)) + 2);
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 2), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)) + 2);
      const z = zone[ia]!;
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const qx = tx + 0.5, qy = ty + 0.5;
          const l0 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / det;
          const l1 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / det;
          const l2 = 1 - l0 - l1;
          const sc = Math.min(l0, l1, l2);
          if (sc < -0.6) continue;
          const o = ty * w + tx;
          if (scoreArr[o]! >= sc) continue;
          const w0 = Math.max(l0, 0), w1 = Math.max(l1, 0), w2 = Math.max(l2, 0);
          const ws = w0 + w1 + w2 || 1;
          const k0 = w0 / ws, k1 = w1 / ws, k2 = w2 / ws;
          const p: Vec3 = [pos[ia * 3]! * k0 + pos[ib * 3]! * k1 + pos[ic * 3]! * k2, pos[ia * 3 + 1]! * k0 + pos[ib * 3 + 1]! * k1 + pos[ic * 3 + 1]! * k2, pos[ia * 3 + 2]! * k0 + pos[ib * 3 + 2]! * k1 + pos[ic * 3 + 2]! * k2];
          const n = vnorm([nrm[ia * 3]! * k0 + nrm[ib * 3]! * k1 + nrm[ic * 3]! * k2, nrm[ia * 3 + 1]! * k0 + nrm[ib * 3 + 1]! * k1 + nrm[ic * 3 + 1]! * k2, nrm[ia * 3 + 2]! * k0 + nrm[ib * 3 + 2]! * k1 + nrm[ic * 3 + 2]! * k2]);
          const a = ao[ia]! * k0 + ao[ib]! * k1 + ao[ic]! * k2;
          if (scoreArr[o]! < 0) covered++;
          scoreArr[o] = sc;
          const ed = ef.query(p);
          write(o, paint({ p, n, zone: z, ao: a, noise, cvx: ed.cvx, ccv: ed.ccv, px: samplePx }));
        }
      }
    }
    return covered;
  };
  const covered = pass(W, H, score, texelSize, (o, r) => {
    col[o * 3] = r.albedo[0]; col[o * 3 + 1] = r.albedo[1]; col[o * 3 + 2] = r.albedo[2];
  });
  log?.(`  baked ${W}x${H}: ${covered} texels (${Math.round((covered / (W * H)) * 100)}% used)`);
  const albedo = finish(col, score, W, H, false);
  let emissive: Baked | undefined;
  if (em && emScore) {
    const emissiveTexelSize = texelSize * Math.max(W / EW, H / EH);
    pass(EW, EH, emScore, emissiveTexelSize, (o, r) => {
      const e = r.emissive ?? [0, 0, 0];
      em[o * 3] = e[0]; em[o * 3 + 1] = e[1]; em[o * 3 + 2] = e[2];
    });
    emissive = finish(em, emScore, EW, EH, true);
  }
  return { albedo, emissive };
}

/** dilate into the gutter and convert to sRGB bytes */
function finish(color: Float32Array, score: Float32Array, W: number, H: number, black: boolean): Baked {
  const filled = new Uint8Array(W * H);
  let avg: Rgb = [0, 0, 0], n = 0;
  for (let i = 0; i < W * H; i++) if (score[i]! >= 0) { filled[i] = 1; avg[0] += color[i * 3]!; avg[1] += color[i * 3 + 1]!; avg[2] += color[i * 3 + 2]!; n++; }
  avg = black ? [0, 0, 0] : [avg[0] / Math.max(1, n), avg[1] / Math.max(1, n), avg[2] / Math.max(1, n)];
  for (let pass = 0; pass < 6; pass++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (filled[o]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (!filled[q]) continue;
          r += color[q * 3]!; g += color[q * 3 + 1]!; b += color[q * 3 + 2]!; c++;
        }
        if (c) { color[o * 3] = r / c; color[o * 3 + 1] = g / c; color[o * 3 + 2] = b / c; next[o] = 1; }
      }
    }
    filled.set(next);
  }
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const f = filled[i]!;
    const r = f ? color[i * 3]! : avg[0], g = f ? color[i * 3 + 1]! : avg[1], b = f ? color[i * 3 + 2]! : avg[2];
    rgba[i * 4] = Math.round(linearToSrgb(clamp01(r)) * 255);
    rgba[i * 4 + 1] = Math.round(linearToSrgb(clamp01(g)) * 255);
    rgba[i * 4 + 2] = Math.round(linearToSrgb(clamp01(b)) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return { rgba };
}

const pow2ceil = (x: number): number => 2 ** Math.ceil(Math.log2(Math.max(8, x)));

/** Bake a finished weapon mesh into shippable ModelData (hand frame). */
export async function bakeWeapon(s: BakeSpec): Promise<ModelData> {
  const log = s.log ?? (() => {});
  const mesh = s.mesh;
  const nv0 = mesh.positions.length / 3;
  const ao0 = vertexAo(mesh.positions, mesh.normals, mesh.indices, 14, 0.11);
  const edgeField = buildEdgeField(mesh);
  let positions = mesh.positions, normals = mesh.normals, indices = mesh.indices;
  let zoneArr = mesh.groups, aoArr = ao0;
  let uvs: Float32Array | undefined;
  let texture: ModelData['texture'];
  let emissive: ModelData['emissive'];
  let layout: string | undefined;
  if (!s.noTexture) {
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a0 = indices[i]! * 3, b0 = indices[i + 1]! * 3, c0 = indices[i + 2]! * 3;
      const ux = positions[b0]! - positions[a0]!, uy = positions[b0 + 1]! - positions[a0 + 1]!, uz = positions[b0 + 2]! - positions[a0 + 2]!;
      const wx = positions[c0]! - positions[a0]!, wy = positions[c0 + 1]! - positions[a0 + 1]!, wz = positions[c0 + 2]! - positions[a0 + 2]!;
      area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    }
    const S = s.size;
    let tpu = Math.sqrt((0.6 * S * S) / area);
    let atlas = await unwrap(positions, indices, { texelsPerUnit: tpu, padding: 3, maxCost: 4 });
    for (let it = 0; it < 2; it++) {
      // fit the longest atlas side to S texels (isotropic), then re-pack
      tpu *= (S - 2) / Math.max(atlas.width, atlas.height);
      atlas = await unwrap(positions, indices, { texelsPerUnit: tpu, padding: 3, maxCost: 4 });
    }
    const fit = S / Math.max(atlas.width, atlas.height);
    const TW = Math.min(S, Math.ceil((atlas.width * Math.min(1, fit)) / 16) * 16), TH = Math.min(S, Math.ceil((atlas.height * Math.min(1, fit)) / 16) * 16);
    const sx = (atlas.width * Math.min(1, fit)) / TW, sy = (atlas.height * Math.min(1, fit)) / TH;
    log(`  unwrapped ${atlas.positions.length / 3} verts (+${atlas.positions.length / 3 - nv0}), atlas ${atlas.width}x${atlas.height} -> ${TW}x${TH}, ${Math.round(tpu)} texels/m`);
    const nv = atlas.positions.length / 3;
    const remapF = (src: Float32Array, stride: number): Float32Array => {
      const o = new Float32Array(nv * stride);
      for (let v = 0; v < nv; v++) o.set(src.subarray(atlas.oldIndex[v]! * stride, atlas.oldIndex[v]! * stride + stride), v * stride);
      return o;
    };
    const zone2 = new Uint16Array(nv);
    for (let v = 0; v < nv; v++) zone2[v] = zoneArr[atlas.oldIndex[v]!]!;
    positions = atlas.positions;
    indices = atlas.indices;
    normals = remapF(normals, 3);
    aoArr = remapF(aoArr, 1);
    zoneArr = zone2;
    uvs = Float32Array.from(atlas.uvs);
    for (let i = 0; i < uvs.length; i += 2) { uvs[i] = uvs[i]! * sx; uvs[i + 1] = uvs[i + 1]! * sy; }
    layout = layoutHash(handPositions(positions, s.hand), uvs, indices);
    const painted = loadPaintedTexture(s.id, layout, log);
    const ES = s.emissiveSize ?? 0;
    const EW = ES > 0 ? Math.max(16, Math.round((TW * ES) / S)) : 0, EH = ES > 0 ? Math.max(16, Math.round((TH * ES) / S)) : 0;
    const baked = bakeMaps(TW, TH, EW, EH, uvs, indices, positions, normals, zoneArr, aoArr, s.paint, edgeField, s.seed, 1 / tpu, log);
    if (process.env.FORGE_DEBUG) {
      const dir = join(repoRoot(), '.research', 'forge', s.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'albedo.png'), encodePng(baked.albedo.rgba, TW, TH));
      if (baked.emissive) writeFileSync(join(dir, 'emissive.png'), encodePng(baked.emissive.rgba, EW, EH));
    }
    texture = painted ?? { webp: encodeWebp(baked.albedo.rgba, TW, TH, s.quality ?? 90), width: TW, height: TH };
    if (painted) log(`  using painted texture ${painted.width}x${painted.height}`);
    if (baked.emissive) emissive = { webp: encodeWebp(baked.emissive.rgba, EW, EH, 85), width: EW, height: EH };
    log(`  albedo ${(texture.webp.length / 1024).toFixed(0)} KB${emissive ? `, emissive ${(emissive.webp.length / 1024).toFixed(0)} KB` : ''}`);
  }
  // vertex colour = AO multiplier when textured (the albedo is already lit-neutral); with no texture the paint is sampled per vertex
  const aoK = s.aoStrength ?? 0.65;
  const colors = new Float32Array(positions.length);
  const vnoise = new Noise(s.seed);
  for (let v = 0; v < positions.length / 3; v++) {
    const k = 1 - aoK * (1 - aoArr[v]!);
    if (s.noTexture) {
      const c = s.paint({ p: [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!], n: [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!], zone: zoneArr[v]!, ao: aoArr[v]!, noise: vnoise, cvx: 0.004, ccv: 0.004, px: 0.01 }).albedo;
      colors[v * 3] = c[0] * k; colors[v * 3 + 1] = c[1] * k; colors[v * 3 + 2] = c[2] * k;
    } else {
      colors[v * 3] = k; colors[v * 3 + 1] = k; colors[v * 3 + 2] = k;
    }
  }
  // canonical -> hand frame
  let minY = Infinity, maxY = -Infinity, r2 = 0;
  const hp = Float32Array.from(positions), hn = Float32Array.from(normals);
  mapVec3(hp, (p) => toHand(p, s.hand));
  mapVec3(hn, (p) => toHand(p, s.hand));
  for (let i = 0; i < hp.length; i += 3) {
    minY = Math.min(minY, hp[i + 2]!);
    maxY = Math.max(maxY, hp[i + 2]!);
    r2 = Math.max(r2, hp[i]! ** 2 + hp[i + 1]! ** 2);
  }
  void vdot;
  return {
    id: s.id,
    kind: s.kind ?? 'weapon',
    positions: hp,
    normals: hn,
    colors,
    indices,
    ...(uvs ? { uvs } : {}),
    ...(texture ? { texture } : {}),
    ...(emissive ? { emissive, emissiveFactor: s.emissiveFactor ?? [1, 1, 1] as [number, number, number] } : {}),
    ...(s.material ? { material: s.material } : {}),
    clips: [],
    height: maxY - minY,
    radius: Math.sqrt(r2),
    extras: { ...(s.extras ?? {}), ...(layout ? { layoutHash: layout } : {}) },
  };
}

const handPositions = (p: Float32Array, hand: Hand): Float32Array => {
  const o = Float32Array.from(p);
  mapVec3(o, (q) => toHand(q, hand));
  return o;
};
