// GLB export following ARCHITECTURE §5.1: one skinned mesh, one material, POSITION/NORMAL/COLOR_0 + JOINTS_0/WEIGHTS_0,
// root joint `root`, clips as glTF animations, scene extras. meshopt-compressed with quantised attributes.
import { Document, NodeIO, type Accessor, type Node } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import type { ModelData } from '../model.ts';

export interface GlbOptions {
  /** quantise POSITION to int16 (needs a loader that honours KHR_mesh_quantization skin correction). Default false: float32. */
  quantizePositions?: boolean;
  /** skip meshopt (debug) */
  noCompress?: boolean;
}

export async function buildGlb(m: ModelData, opts: GlbOptions = {}): Promise<Uint8Array> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'metin-survivors forge';
  const buffer = doc.createBuffer();
  const scene = doc.createScene(m.id);
  doc.getRoot().setDefaultScene(scene);

  // model arrays are plain ArrayBuffer-backed (never shared), so the narrowing cast is sound
  const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', array: Float32Array | Uint8Array | Uint16Array | Uint32Array, normalized = false): Accessor =>
    doc.createAccessor().setType(type).setArray(array as Float32Array<ArrayBuffer>).setBuffer(buffer).setNormalized(normalized);

  const colors = new Float32Array((m.colors.length / 3) * 4);
  for (let v = 0; v < m.colors.length / 3; v++) {
    colors[v * 4] = m.colors[v * 3]!; colors[v * 4 + 1] = m.colors[v * 3 + 1]!; colors[v * 4 + 2] = m.colors[v * 3 + 2]!; colors[v * 4 + 3] = 1;
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', m.positions))
    .setAttribute('NORMAL', acc('VEC3', m.normals))
    .setAttribute('COLOR_0', acc('VEC4', colors))
    .setIndices(acc('SCALAR', m.positions.length / 3 > 65535 ? m.indices : Uint16Array.from(m.indices)));
  if (m.uvs) prim.setAttribute('TEXCOORD_0', acc('VEC2', m.uvs));
  if (m.skin) {
    prim.setAttribute('JOINTS_0', acc('VEC4', m.skin.joints));
    prim.setAttribute('WEIGHTS_0', acc('VEC4', m.skin.weights, true));
  }
  const material = doc.createMaterial(m.id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(m.material?.roughness ?? 0.88).setMetallicFactor(m.material?.metallic ?? 0).setDoubleSided(false);
  if (m.texture) {
    const tex = doc.createTexture(`${m.id}_albedo`).setImage(m.texture.webp).setMimeType('image/webp');
    material.setBaseColorTexture(tex);
    material.getBaseColorTextureInfo()?.setWrapS(33071).setWrapT(33071);
    doc.createExtension(EXTTextureWebP).setRequired(true);
  }
  if (m.emissive) {
    if (!m.uvs) throw new Error(`${m.id}: emissive map needs uvs`);
    const etex = doc.createTexture(`${m.id}_emissive`).setImage(m.emissive.webp).setMimeType('image/webp');
    material.setEmissiveTexture(etex).setEmissiveFactor(m.emissiveFactor ?? [1, 1, 1]);
    material.getEmissiveTextureInfo()?.setWrapS(33071).setWrapT(33071);
    doc.createExtension(EXTTextureWebP).setRequired(true);
  } else if (m.emissiveFactor) {
    material.setEmissiveFactor(m.emissiveFactor);
  }
  prim.setMaterial(material);
  const mesh = doc.createMesh(m.id).addPrimitive(prim);
  const meshNode = doc.createNode(m.id).setMesh(mesh);

  const nodes: Node[] = [];
  if (m.skin) {
    const sk = m.skin.skeleton;
    sk.bones.forEach((b, i) => {
      const n = doc.createNode(b.name).setTranslation(sk.offset[i]!);
      nodes.push(n);
      const p = sk.parent[i]!;
      if (p >= 0) nodes[p]!.addChild(n);
    });
    const ibm = new Float32Array(sk.count * 16);
    sk.inverseBind().forEach((mat, i) => ibm.set(mat, i * 16));
    const skin = doc.createSkin(m.id).setInverseBindMatrices(acc('MAT4', ibm)).setSkeleton(nodes[0]!);
    for (const n of nodes) skin.addJoint(n);
    meshNode.setSkin(skin);
    scene.addChild(nodes[0]!);
  }
  scene.addChild(meshNode);

  if (m.skin) {
    for (const clip of m.clips) {
      const anim = doc.createAnimation(clip.name);
      const times = new Float32Array(clip.keys);
      for (let k = 0; k < clip.keys; k++) times[k] = (k / (clip.keys - 1)) * clip.duration;
      const input = acc('SCALAR', times);
      for (const tr of clip.tracks) {
        const node = nodes[tr.bone]!;
        if (tr.rot) {
          const s = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC4', tr.rot)).setInterpolation('LINEAR');
          anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(s));
        }
        if (tr.pos) {
          // offsets are relative to rest; glTF translation channels are absolute local translation
          const abs = new Float32Array(tr.pos.length);
          const off = m.skin.skeleton.offset[tr.bone]!;
          for (let k = 0; k < clip.keys; k++) for (let c = 0; c < 3; c++) abs[k * 3 + c] = tr.pos[k * 3 + c]! + off[c]!;
          const s = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC3', abs)).setInterpolation('LINEAR');
          anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(s));
        }
        if (tr.scale) {
          const s = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC3', tr.scale)).setInterpolation('LINEAR');
          anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('scale').setSampler(s));
        }
      }
    }
  }

  const hit: Record<string, number> = {};
  for (const c of m.clips) if (c.hit !== undefined) hit[c.name] = round3(c.hit);
  scene.setExtras({
    id: m.id,
    kind: m.kind,
    height: round3(m.height),
    radius: round3(m.radius),
    hit,
    sockets: m.sockets ?? {},
    ...(m.palette ? { palette: m.palette } : {}),
    ...(m.extras ?? {}),
  });

  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  if (!opts.noCompress) {
    // meshopt() would force 14-bit positions; compose its parts ourselves so skinned positions stay float32 unless asked.
    await doc.transform(
      resample({ tolerance: 1e-4 }),
      reorder({ encoder: MeshoptEncoder, target: 'size' }),
      quantize({
        pattern: opts.quantizePositions ? /^(POSITION|NORMAL|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/ : /^(NORMAL|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/,
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeColor: 8,
        quantizeTexcoord: 12,
        quantizeWeight: 8,
        quantizeGeneric: 12,
      }),
    );
    doc.createExtension(KHRMeshQuantization).setRequired(true); // quantised (octahedral) normals are non-float
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }
  return io.writeBinary(doc);
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
