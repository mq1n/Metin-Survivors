// GLB I/O for the painter: decode geometry (meshopt/quantised) for the python passes, fingerprint it, and swap the
// baseColorTexture image *at the binary level* so everything else (meshopt streams, skin, clips, extras) stays byte-identical.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Accessor, type Node, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export interface PaintPrim {
  index: number;
  name: string;
  materialIndex: number;
  skinned: boolean;
  positions: Float32Array; // rest pose, metres
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null; // RGB
  indices: Uint32Array;
  texture: { bytes: Uint8Array; mime: string } | null;
}

export interface GlbMesh {
  prims: PaintPrim[];
  extras: Record<string, unknown>;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

async function makeIo(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

function readAttr(acc: Accessor | null, n: number, comps: number): Float32Array | null {
  if (!acc) return null;
  const out = new Float32Array(n * comps);
  const tmp: number[] = new Array(comps).fill(0);
  for (let i = 0; i < n; i++) {
    acc.getElement(i, tmp);
    for (let c = 0; c < comps; c++) out[i * comps + c] = tmp[c]!;
  }
  return out;
}

export async function readGlb(bytes: Uint8Array): Promise<GlbMesh> {
  const io = await makeIo();
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  const materials = root.listMaterials();
  const prims: PaintPrim[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const visit = (node: Node): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const skinned = !!node.getSkin();
      const wm = node.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const posAcc = p.getAttribute('POSITION');
        if (!posAcc) continue;
        const n = posAcc.getCount();
        const positions = readAttr(posAcc, n, 3)!;
        const normals = readAttr(p.getAttribute('NORMAL'), n, 3) ?? new Float32Array(n * 3);
        const uvs = readAttr(p.getAttribute('TEXCOORD_0'), n, 2);
        const col4 = readAttr(p.getAttribute('COLOR_0'), n, p.getAttribute('COLOR_0')?.getType() === 'VEC3' ? 3 : 4);
        let colors: Float32Array | null = null;
        if (col4) {
          const comps = col4.length / n;
          colors = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) colors[i * 3 + c] = col4[i * comps + c]!;
        }
        if (!skinned) {
          // static meshes may carry a node transform (quantised positions); bake it in
          for (let i = 0; i < n; i++) {
            const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
            positions[i * 3] = wm[0]! * x + wm[4]! * y + wm[8]! * z + wm[12]!;
            positions[i * 3 + 1] = wm[1]! * x + wm[5]! * y + wm[9]! * z + wm[13]!;
            positions[i * 3 + 2] = wm[2]! * x + wm[6]! * y + wm[10]! * z + wm[14]!;
            const nx = normals[i * 3]!, ny = normals[i * 3 + 1]!, nz = normals[i * 3 + 2]!;
            normals[i * 3] = wm[0]! * nx + wm[4]! * ny + wm[8]! * nz;
            normals[i * 3 + 1] = wm[1]! * nx + wm[5]! * ny + wm[9]! * nz;
            normals[i * 3 + 2] = wm[2]! * nx + wm[6]! * ny + wm[10]! * nz;
          }
        }
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
          min[c] = Math.min(min[c]!, positions[i * 3 + c]!);
          max[c] = Math.max(max[c]!, positions[i * 3 + c]!);
        }
        const idxAcc = p.getIndices();
        const ic = idxAcc ? idxAcc.getCount() : n;
        const indices = new Uint32Array(ic);
        for (let i = 0; i < ic; i++) indices[i] = idxAcc ? (idxAcc.getScalar(i) as number) : i;
        const mat = p.getMaterial();
        const tex = mat?.getBaseColorTexture();
        const img = tex?.getImage();
        prims.push({
          index: prims.length,
          name: mesh.getName() || node.getName(),
          materialIndex: mat ? materials.indexOf(mat) : -1,
          skinned,
          positions, normals, uvs, colors, indices,
          texture: tex && img ? { bytes: new Uint8Array(img), mime: tex.getMimeType() } : null,
        });
      }
    }
    for (const c of node.listChildren()) visit(c);
  };
  for (const scene of root.listScenes()) for (const n of scene.listChildren()) visit(n);
  return { prims, extras: (root.listScenes()[0]?.getExtras() ?? {}) as Record<string, unknown>, bounds: { min, max } };
}

/** Stable fingerprint of the decoded final geometry + UV layout (what a baked texture is bound to). */
export function geometryFingerprint(m: GlbMesh): string {
  const h = createHash('sha1');
  for (const p of m.prims) {
    const q = (a: Float32Array | null, s: number): Int32Array => {
      const o = new Int32Array(a?.length ?? 0);
      if (a) for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i]! * s);
      return o;
    };
    h.update(Buffer.from(q(p.positions, 2000).buffer)); // 0.5 mm
    h.update(Buffer.from(q(p.uvs, 1000).buffer)); // texel-level at 1k
    h.update(Buffer.from(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength));
  }
  return h.digest('hex').slice(0, 16);
}

/** Write the python exchange: <dir>/meta.json + p<i>_{pos,nrm,uv,col}.f32 + p<i>_idx.u32 + p<i>_tex.<ext> */
export function dumpMesh(m: GlbMesh, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const meta = {
    bounds: m.bounds,
    extras: m.extras,
    prims: m.prims.map((p) => ({
      index: p.index, name: p.name, skinned: p.skinned, verts: p.positions.length / 3, tris: p.indices.length / 3,
      hasUv: !!p.uvs, hasColor: !!p.colors, texture: p.texture ? `p${p.index}_tex.${p.texture.mime.includes('webp') ? 'webp' : p.texture.mime.includes('png') ? 'png' : 'jpg'}` : null,
    })),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  const w = (name: string, a: ArrayBufferView): void => writeFileSync(join(dir, name), new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  for (const p of m.prims) {
    w(`p${p.index}_pos.f32`, p.positions);
    w(`p${p.index}_nrm.f32`, p.normals);
    if (p.uvs) w(`p${p.index}_uv.f32`, p.uvs);
    if (p.colors) w(`p${p.index}_col.f32`, p.colors);
    w(`p${p.index}_idx.u32`, p.indices);
    const t = meta.prims[p.index]!.texture;
    if (t && p.texture) writeFileSync(join(dir, t), p.texture.bytes);
  }
}

interface GltfJson {
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number; extensions?: unknown }[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures?: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }[];
  images?: { bufferView?: number; mimeType?: string; extras?: Record<string, unknown> }[];
}

/**
 * Replace the baseColorTexture image of `materialIndex` with `image` (webp/png bytes). Everything else in the BIN chunk is
 * copied verbatim (4-byte aligned). The image keeps its extension routing: webp stays EXT_texture_webp, png/jpeg use `source`.
 */
export function injectTexture(glb: Uint8Array, materialIndex: number, image: Uint8Array, mime: 'image/webp' | 'image/png', extras?: Record<string, unknown>): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: JSON chunk expected first');
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as GltfJson & Record<string, unknown>;
  const binStart = 20 + jsonLen;
  const binLen = dv.getUint32(binStart, true);
  if (dv.getUint32(binStart + 4, true) !== 0x004e4942) throw new Error('GLB: BIN chunk expected second');
  const bin = glb.subarray(binStart + 8, binStart + 8 + binLen);

  const mat = json.materials?.[materialIndex];
  const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texIdx === undefined) throw new Error(`material ${materialIndex} has no baseColorTexture`);
  const tex = json.textures![texIdx]!;
  const imgIdx = tex.extensions?.EXT_texture_webp?.source ?? tex.source!;
  const img = json.images![imgIdx]!;
  if (img.bufferView === undefined) throw new Error('image is not embedded');
  const target = img.bufferView;

  // reroute texture source for the new mime type
  if (mime === 'image/png') {
    if (tex.extensions?.EXT_texture_webp) {
      delete tex.extensions.EXT_texture_webp;
      if (Object.keys(tex.extensions).length === 0) delete tex.extensions;
    }
    tex.source = imgIdx;
  } else if (tex.extensions?.EXT_texture_webp) {
    tex.extensions.EXT_texture_webp.source = imgIdx;
  } else {
    // png -> webp: route through the extension (+ required flag)
    tex.extensions = { EXT_texture_webp: { source: imgIdx } };
    delete tex.source;
    const j = json as Record<string, unknown>;
    for (const k of ['extensionsUsed', 'extensionsRequired']) {
      const arr = (j[k] as string[] | undefined) ?? [];
      if (!arr.includes('EXT_texture_webp') && (k === 'extensionsUsed' || k === 'extensionsRequired')) arr.push('EXT_texture_webp');
      j[k] = arr;
    }
  }
  img.mimeType = mime;
  if (extras) img.extras = { ...(img.extras ?? {}), ...extras };

  // rebuild BIN. Byte ranges of buffer 0 are owned either by a bufferView (plain data, e.g. the image) or by the
  // EXT_meshopt_compression extension of a fallback bufferView (compressed streams live in buffer 0 at ext.byteOffset).
  interface Range { byteOffset?: number; byteLength: number }
  const ranges: { r: Range; replace?: Uint8Array }[] = [];
  json.bufferViews.forEach((bv, i) => {
    if (bv.buffer === 0) ranges.push({ r: bv, replace: i === target ? image : undefined });
    const ext = (bv.extensions as { EXT_meshopt_compression?: Range & { buffer: number } } | undefined)?.EXT_meshopt_compression;
    if (ext && ext.buffer === 0) ranges.push({ r: ext });
  });
  ranges.sort((a, b) => (a.r.byteOffset ?? 0) - (b.r.byteOffset ?? 0));
  const parts: Uint8Array[] = [];
  let off = 0;
  for (const { r, replace } of ranges) {
    const data = replace ?? bin.subarray(r.byteOffset ?? 0, (r.byteOffset ?? 0) + r.byteLength);
    const pad = (4 - (off % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); off += pad; }
    r.byteOffset = off;
    r.byteLength = data.length;
    parts.push(data);
    off += data.length;
  }
  const newBinLen = off;
  const binPad = (4 - (newBinLen % 4)) % 4;
  json.buffers[0]!.byteLength = newBinLen;

  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad).fill(0x20); t.set(js); js = t; }
  const total = 12 + 8 + js.length + 8 + newBinLen + binPad;
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, js.length, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20);
  let p = 20 + js.length;
  o.setUint32(p, newBinLen + binPad, true); o.setUint32(p + 4, 0x004e4942, true);
  p += 8;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
