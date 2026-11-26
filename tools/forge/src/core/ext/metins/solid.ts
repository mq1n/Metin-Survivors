// Flat-faceted solids -> skinned ModelData with a baked albedo + emissive atlas.
//   faces (Poly output, one bone each) -> flat-shaded triangle mesh -> xatlas (outer + chamfer faces only) ->
//   per-texel shading callback (3-D position, face normal, edge distances) -> albedo/emissive WebP.
// Fracture (CRACK) faces are hidden until a chunk breaks away and chamfer strips are thin; both share a tiny reserved band at
// the bottom of the atlas (upper half crack, lower half chamfer; u picks a colour column, see `bandPaint`) instead of costing texel density.
import { encodeWebp } from '../../export/image.ts';
import type { Vec3 } from '../../math.ts';
import { vcross, vdot, vlen, vnorm, vsub } from '../../math.ts';
import { unwrap } from '../../mesh/atlas.ts';
import type { ModelData, ModelKind } from '../../model.ts';
import type { ClipData } from '../../anim/clip.ts';
import type { Skeleton } from '../../skin/skeleton.ts';
import { CLS, type Face, Poly } from './poly.ts';

export interface SolidFace extends Face {
  bone: number;
  /** painter-defined group (e.g. which hull / part the face belongs to) */
  part: number;
  /** class of the face across each polygon edge i (pts[i] -> pts[i+1]); -1 = open */
  edgeCls: number[];
}

export interface PolyPart {
  poly: Poly;
  bone: number;
  part: number;
}

/** flatten polyhedra into annotated faces */
export function flatten(parts: readonly PolyPart[]): SolidFace[] {
  const out: SolidFace[] = [];
  for (const pp of parts) {
    const key = (p: Vec3): string => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    const dir = new Map<string, number>();
    pp.poly.faces.forEach((f, fi) => f.pts.forEach((p, i) => dir.set(`${key(p)}|${key(f.pts[(i + 1) % f.pts.length]!)}`, fi)));
    for (const f of pp.poly.faces) {
      const edgeCls = f.pts.map((p, i) => {
        const nb = dir.get(`${key(f.pts[(i + 1) % f.pts.length]!)}|${key(p)}`);
        return nb === undefined ? -1 : pp.poly.faces[nb]!.cls;
      });
      out.push({ pts: f.pts, cls: f.cls, plane: f.plane, bone: pp.bone, part: pp.part, edgeCls });
    }
  }
  return out;
}

export const faceNormalOf = (f: Face): Vec3 => {
  let n: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < f.pts.length; i++) {
    const c = vcross(vsub(f.pts[i]!, f.pts[0]!), vsub(f.pts[i + 1]!, f.pts[0]!));
    n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
  }
  return vnorm(n);
};

const faceArea = (f: Face): number => {
  let n: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < f.pts.length; i++) {
    const c = vcross(vsub(f.pts[i]!, f.pts[0]!), vsub(f.pts[i + 1]!, f.pts[0]!));
    n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
  }
  return vlen(n) / 2;
};

export interface ShadeCtx {
  p: Vec3;
  n: Vec3;
  face: SolidFace;
  faceId: number;
  /** distance (m) to the nearest polygon edge whose neighbour is OUTER / CRACK / CHAMFER (Infinity if none) */
  edge: [number, number, number];
  /** distance to the nearest edge of any kind */
  edgeAny: number;
}

export interface ShadeOut {
  /** sRGB 0..1 */
  rgb: Vec3;
  /** emissive mask 0..1 */
  emissive: number;
}

export interface BakeOpts {
  size: number;
  /** fraction of the atlas height reserved at the bottom for the fracture-face band */
  band?: number;
  /** target atlas fill (0..1) used to pick texel density */
  fill?: number;
  shade: (c: ShadeCtx) => ShadeOut;
  /** colour of a band face for colour column `u` (0..1); kind 0 = fracture face, 1 = chamfer strip */
  bandPaint: (u: number, v: number, kind: 0 | 1) => ShadeOut;
  log?: (s: string) => void;
  webpQuality?: number;
}

export interface SolidResult {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** bone index per vertex (rigid skinning) */
  bone: Uint8Array;
  albedo: Uint8Array;
  emissive: Uint8Array;
}

const distToSeg = (p: Vec3, a: Vec3, b: Vec3): number => {
  const ab = vsub(b, a), ap = vsub(p, a);
  const l2 = vdot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, vdot(ap, ab) / l2)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};

export async function bakeSolid(faces: readonly SolidFace[], o: BakeOpts): Promise<SolidResult> {
  const S = o.size;
  const band = o.band ?? 0.04;
  const fill = o.fill ?? 0.72;
  const log = o.log ?? (() => {});
  const atlasFaces: number[] = [];
  const crackFaces: number[] = [];
  faces.forEach((f, i) => (f.cls === CLS.CRACK || f.cls === CLS.CHAMFER ? crackFaces : atlasFaces).push(i));

  // 1. atlas input: outer + chamfer faces, vertices not shared between faces (flat shading)
  const aPos: number[] = [];
  const aIdx: number[] = [];
  const aFace: number[] = [];
  let area = 0;
  for (const fi of atlasFaces) {
    const f = faces[fi]!;
    area += faceArea(f);
    const base = aPos.length / 3;
    for (const p of f.pts) { aPos.push(p[0], p[1], p[2]); aFace.push(fi); }
    for (let k = 1; k + 1 < f.pts.length; k++) aIdx.push(base, base + k, base + k + 1);
  }
  const positions0 = Float32Array.from(aPos), indices0 = Uint32Array.from(aIdx);
  let tpu = Math.sqrt((fill * S * S * (1 - band)) / area);
  let atlas = await unwrap(positions0, indices0, { texelsPerUnit: tpu, padding: 3, maxCost: 3 });
  for (let tries = 0; tries < 6 && (atlas.width > S || atlas.height > S * (1 - band)); tries++) {
    tpu *= Math.min(S / atlas.width, (S * (1 - band)) / atlas.height) * 0.97;
    atlas = await unwrap(positions0, indices0, { texelsPerUnit: tpu, padding: 3, maxCost: 3 });
  }
  log(`  atlas ${atlas.width}x${atlas.height} in ${S}x${S} (${Math.round(tpu)} texels/m, ${atlasFaces.length} faces, ${crackFaces.length} fracture faces)`);

  // 2. assemble final mesh: atlas vertices then fracture faces
  const nA = atlas.positions.length / 3;
  let nC = 0;
  for (const fi of crackFaces) nC += faces[fi]!.pts.length + (faces[fi]!.cls === CLS.CHAMFER ? 0 : 1);
  const nv = nA + nC;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), bone = new Uint8Array(nv);
  const faceOf = new Uint32Array(nv);
  const idx: number[] = Array.from(atlas.indices);
  positions.set(atlas.positions);
  for (let v = 0; v < nA; v++) {
    const fi = aFace[atlas.oldIndex[v]!]!;
    const n = faceNormalOf(faces[fi]!);
    normals.set(n, v * 3);
    uvs[v * 2] = atlas.uvs[v * 2]! * (atlas.width / S);
    uvs[v * 2 + 1] = atlas.uvs[v * 2 + 1]! * (atlas.height / S);
    bone[v] = faces[fi]!.bone;
    faceOf[v] = fi;
  }
  let w = nA;
  const subBand = band / 2;
  for (const fi of crackFaces) {
    const f = faces[fi]!;
    const n = faceNormalOf(f);
    const base = w;
    const u = 0.04 + 0.92 * (((f.part * 0.6180339 + f.bone * 0.37) % 1 + 1) % 1);
    const chamfer = f.cls === CLS.CHAMFER;
    // fracture faces fan from a centroid vertex: v runs from the hot core (centre) to the cool rim; chamfer strips stay flat
    const m = f.pts.length;
    const vCentre = chamfer ? 1 - subBand / 2 : 1 - subBand - subBand * 0.9;
    const vRim = chamfer ? 1 - subBand / 2 : 1 - subBand - subBand * 0.1;
    const cen: Vec3 = [0, 0, 0];
    for (const p of f.pts) { cen[0] += p[0] / m; cen[1] += p[1] / m; cen[2] += p[2] / m; }
    for (const p of f.pts) {
      positions.set(p, w * 3); normals.set(n, w * 3);
      uvs[w * 2] = u; uvs[w * 2 + 1] = vRim;
      bone[w] = f.bone; faceOf[w] = fi; w++;
    }
    if (chamfer) {
      for (let k = 1; k + 1 < m; k++) idx.push(base, base + k, base + k + 1);
    } else {
      positions.set(cen, w * 3); normals.set(n, w * 3);
      uvs[w * 2] = u; uvs[w * 2 + 1] = vCentre;
      bone[w] = f.bone; faceOf[w] = fi;
      for (let k = 0; k < m; k++) idx.push(base + k, base + ((k + 1) % m), w);
      w++;
    }
  }

  // 3. bake texels
  const albedo = new Uint8Array(S * S * 4), emissive = new Uint8Array(S * S * 4);
  const covered = new Uint8Array(S * S);
  const put = (x: number, y: number, out: ShadeOut): void => {
    const i = y * S + x;
    albedo[i * 4] = Math.round(Math.min(1, Math.max(0, out.rgb[0])) * 255);
    albedo[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, out.rgb[1])) * 255);
    albedo[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, out.rgb[2])) * 255);
    albedo[i * 4 + 3] = 255;
    const e = Math.round(Math.min(1, Math.max(0, out.emissive)) * 255);
    emissive[i * 4] = e; emissive[i * 4 + 1] = e; emissive[i * 4 + 2] = e; emissive[i * 4 + 3] = 255;
    covered[i] = 1;
  };
  const edgeCache = new Map<number, { a: Vec3; b: Vec3; cls: number }[]>();
  const edgesOf = (fi: number): { a: Vec3; b: Vec3; cls: number }[] => {
    let e = edgeCache.get(fi);
    if (!e) {
      const f = faces[fi]!;
      e = f.pts.map((p, i) => ({ a: p, b: f.pts[(i + 1) % f.pts.length]!, cls: f.edgeCls[i]! }));
      edgeCache.set(fi, e);
    }
    return e;
  };
  const nTri = idx.length / 3;
  for (let t = 0; t < nTri; t++) {
    const i0 = idx[t * 3]!, i1 = idx[t * 3 + 1]!, i2 = idx[t * 3 + 2]!;
    if (i0 >= nA) continue; // fracture faces: band only
    const fi = faceOf[i0]!;
    const face = faces[fi]!;
    const n = faceNormalOf(face);
    const x0 = uvs[i0 * 2]! * S, y0 = uvs[i0 * 2 + 1]! * S, x1 = uvs[i1 * 2]! * S, y1 = uvs[i1 * 2 + 1]! * S, x2 = uvs[i2 * 2]! * S, y2 = uvs[i2 * 2 + 1]! * S;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1)), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1)), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
    const P0 = positions.subarray(i0 * 3, i0 * 3 + 3), P1 = positions.subarray(i1 * 3, i1 * 3 + 3), P2 = positions.subarray(i2 * 3, i2 * 3 + 3);
    const edges = edgesOf(fi);
    const tol = -0.02;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        const l0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / den;
        const l1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < tol || l1 < tol || l2 < tol) continue;
        const i = y * S + x;
        if (covered[i]) continue;
        const p: Vec3 = [P0[0]! * l0 + P1[0]! * l1 + P2[0]! * l2, P0[1]! * l0 + P1[1]! * l1 + P2[1]! * l2, P0[2]! * l0 + P1[2]! * l1 + P2[2]! * l2];
        const edge: [number, number, number] = [Infinity, Infinity, Infinity];
        let any = Infinity;
        for (const e of edges) {
          const d = distToSeg(p, e.a, e.b);
          any = Math.min(any, d);
          if (e.cls >= 0 && d < edge[e.cls]!) edge[e.cls] = d;
          else if (e.cls < 0 && d < edge[0]) edge[0] = d;
        }
        put(x, y, o.shade({ p, n, face, faceId: fi, edge, edgeAny: any }));
      }
    }
  }
  // band for fracture faces
  const bandY0 = Math.floor(S * (1 - band));
  const bandMid = bandY0 + (S - bandY0) / 2;
  for (let y = bandY0; y < S; y++) {
    const kind = y < bandMid ? 0 : 1;
    const v = kind === 0 ? (y - bandY0 + 0.5) / (bandMid - bandY0) : (y - bandMid + 0.5) / (S - bandMid);
    for (let x = 0; x < S; x++) put(x, y, o.bandPaint((x + 0.5) / S, v, kind));
  }

  // 4. dilate into the padding so bilinear filtering / mips never see the background
  const cov = covered.slice();
  for (let pass = 0; pass < 6; pass++) {
    const next = cov.slice();
    const aCopy = albedo.slice(), eCopy = emissive.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (cov[i]) continue;
      let n = 0, r = 0, g = 0, b = 0, e = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const j = yy * S + xx;
        if (!cov[j]) continue;
        n++; r += aCopy[j * 4]!; g += aCopy[j * 4 + 1]!; b += aCopy[j * 4 + 2]!; e += eCopy[j * 4]!;
      }
      if (n) {
        albedo[i * 4] = r / n; albedo[i * 4 + 1] = g / n; albedo[i * 4 + 2] = b / n; albedo[i * 4 + 3] = 255;
        emissive[i * 4] = emissive[i * 4 + 1] = emissive[i * 4 + 2] = e / n; emissive[i * 4 + 3] = 255;
        next[i] = 1;
      }
    }
    cov.set(next);
  }
  for (let i = 0; i < S * S; i++) if (!cov[i]) { albedo[i * 4 + 3] = 255; emissive[i * 4 + 3] = 255; }

  return { positions, normals, uvs, indices: Uint32Array.from(idx), bone, albedo, emissive };
}

export interface SolidModelOpts {
  id: string;
  kind: ModelKind;
  skeleton: Skeleton;
  clips: ClipData[];
  baked: SolidResult;
  size: number;
  quality?: number;
  emissiveFactor?: [number, number, number];
  material?: { roughness?: number; metallic?: number };
  extras?: Record<string, unknown>;
  radius?: number;
}

/** wrap a bake result into ModelData (rigid skinning: weight 255 on the face's bone) */
export function solidToModel(o: SolidModelOpts): ModelData {
  const b = o.baked;
  const nv = b.positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < nv; v++) {
    const x = b.positions[v * 3]!, y = b.positions[v * 3 + 1]!, z = b.positions[v * 3 + 2]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const joints = new Uint8Array(nv * 4), weights = new Uint8Array(nv * 4);
  for (let v = 0; v < nv; v++) { joints[v * 4] = b.bone[v]!; weights[v * 4] = 255; }
  const q = o.quality ?? 90;
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    id: o.id,
    kind: o.kind,
    positions: b.positions,
    normals: b.normals,
    colors: new Float32Array(nv * 3).fill(1),
    indices: b.indices,
    uvs: b.uvs,
    texture: { webp: encodeWebp(b.albedo, o.size, o.size, q), width: o.size, height: o.size },
    emissive: { webp: encodeWebp(b.emissive, o.size, o.size, q), width: o.size, height: o.size },
    ...(o.emissiveFactor ? { emissiveFactor: o.emissiveFactor } : {}),
    ...(o.material ? { material: o.material } : {}),
    skin: { skeleton: o.skeleton, joints, weights },
    clips: o.clips,
    height: maxY,
    radius: o.radius ?? r3(Math.max(maxX, -minX, maxZ, -minZ)),
    extras: { ...(o.extras ?? {}), bounds: { min: [minX, minY, minZ].map(r3), max: [maxX, maxY, maxZ].map(r3) } },
  };
}
