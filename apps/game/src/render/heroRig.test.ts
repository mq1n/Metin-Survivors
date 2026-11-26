// rig1to1 R7 contract test: verifies every shipped rig1to1 hero GLB against the rig1to1/2 skeleton, socket, clip, and Golden Rule contracts.
// Scoped to hero rows whose GLB carries extras.rig starting with 'rig1to1/' until RIG1TO1_ALL_ROWS is flipped to true when all 36 heroes are shipped.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import { EQUIP_JOINTS_MARK } from './weaponHands';

export const RIG1TO1_ALL_ROWS = true;

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const PUB = resolve(REPO, 'apps/game/public');

interface ManifestHero {
  id: string;
  url: string;
  kind: string;
  clips: Record<string, { duration: number; loop: boolean }>;
  hit?: Record<string, number>;
  sockets?: Record<string, string>;
  bones: number;
}

interface GltfJson {
  scenes?: { extras?: Record<string, unknown> }[];
  nodes?: { name?: string }[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  skins?: { joints: number[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }[];
  bufferViews?: {
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    extensions?: { EXT_meshopt_compression?: { byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } };
  }[];
  animations?: {
    name: string;
    channels: { sampler: number; target: { node?: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
}

const models = JSON.parse(readFileSync(resolve(PUB, 'assets/manifest/models.json'), 'utf8')) as Record<string, ManifestHero>;
const heroRows = Object.values(models).filter((m) => m.kind === 'hero').sort((a, b) => a.id.localeCompare(b.id));

function parseGlb(url: string): { json: GltfJson; bin: Uint8Array } {
  const buf = readFileSync(resolve(PUB, url));
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8')) as GltfJson;
  const binStart = 20 + jlen;
  const blen = binStart + 8 <= buf.length ? buf.readUInt32LE(binStart) : 0;
  const bin = new Uint8Array(buf.buffer, buf.byteOffset + binStart + 8, blen);
  return { json, bin };
}

function decodeView(json: GltfJson, bin: Uint8Array, bvIdx: number): Uint8Array {
  const bv = json.bufferViews![bvIdx]!;
  const ext = bv.extensions?.EXT_meshopt_compression;
  if (!ext) {
    const off = bv.byteOffset ?? 0;
    return bin.subarray(off, off + bv.byteLength);
  }
  const srcOff = ext.byteOffset ?? 0;
  const src = bin.subarray(srcOff, srcOff + ext.byteLength);
  const dst = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(dst, ext.count, ext.byteStride, src, ext.mode as 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES', ext.filter as 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL' | undefined);
  return dst;
}

const TYPE_COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readFloats(json: GltfJson, bin: Uint8Array, accIdx: number, cache: Map<number, Uint8Array>): Float32Array {
  const acc = json.accessors![accIdx]!;
  const bvIdx = acc.bufferView!;
  let view = cache.get(bvIdx);
  if (!view) {
    view = decodeView(json, bin, bvIdx);
    cache.set(bvIdx, view);
  }
  const comps = TYPE_COMPS[acc.type] ?? 1;
  const off = acc.byteOffset ?? 0;
  const out = new Float32Array(acc.count * comps);
  const dv = new DataView(view.buffer, view.byteOffset + off);
  const ct = acc.componentType;
  const elemBytes = ct === 5126 ? 4 : (ct === 5122 || ct === 5123) ? 2 : 1;
  const stride = json.bufferViews![bvIdx]!.byteStride ?? comps * elemBytes;
  const norm = acc.normalized === true;
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < comps; k++) {
      const o = i * stride + k * elemBytes;
      let v: number;
      if (ct === 5126) v = dv.getFloat32(o, true);
      else if (ct === 5122) v = norm ? Math.max(-1, dv.getInt16(o, true) / 32767) : dv.getInt16(o, true);
      else if (ct === 5123) v = norm ? dv.getUint16(o, true) / 65535 : dv.getUint16(o, true);
      else if (ct === 5120) v = norm ? Math.max(-1, dv.getInt8(o) / 127) : dv.getInt8(o);
      else v = norm ? dv.getUint8(o) / 255 : dv.getUint8(o);
      out[i * comps + k] = v;
    }
  }
  return out;
}

function quatAngleDeg(a: Float32Array, ai: number, b: Float32Array, bi: number): number {
  const la = Math.hypot(a[ai]!, a[ai + 1]!, a[ai + 2]!, a[ai + 3]!) || 1;
  const lb = Math.hypot(b[bi]!, b[bi + 1]!, b[bi + 2]!, b[bi + 3]!) || 1;
  const dot = Math.min(1, Math.abs((a[ai]! * b[bi]! + a[ai + 1]! * b[bi + 1]! + a[ai + 2]! * b[bi + 2]! + a[ai + 3]! * b[bi + 3]!) / (la * lb)));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

const EQUIP_NAMES = new Set(['hand_r', 'hand_l', 'hand_r_b', 'hand_l_b', 'head', 'chest', 'back', 'muzzle']);
const ALLOWED_NODE_NAME =
  /^(?:Root|Pelvis|Spine\d*|Neck|Head(?:Nub)?|Hair_\d+|Skirt_[BFLR]_\d+|[LR]_(?:Clavicle|Deltoid|UpperArm|UpArmTwist|ElbowHelper|ForeArm|ForeTwist\d+|Hand|Thigh|KneeHelper|Calf|Foot|Toe0(?:Nub)?)|hand_[lr](?:_b)?|head|chest|back|muzzle|tripo_node_[0-9a-f-]+)$/;

describe('heroRig (R7 contract)', async () => {
  await MeshoptDecoder.ready;

  const rigRows: ManifestHero[] = [];
  const skipped: string[] = [];
  for (const row of heroRows) {
    const { json } = parseGlb(row.url);
    const rig = json.scenes?.[0]?.extras?.rig;
    if (RIG1TO1_ALL_ROWS || (typeof rig === 'string' && rig.startsWith('rig1to1/'))) {
      rigRows.push(row);
    } else {
      skipped.push(row.id);
    }
  }

  it('tracks shipped rig1to1 hero coverage', () => {
    if (RIG1TO1_ALL_ROWS) {
      expect(skipped).toEqual([]);
      expect(rigRows.length).toBe(36);
    } else {
      expect(rigRows.length + skipped.length).toBe(36);
    }
  });

  for (const row of rigRows) {
    it(`${row.id} satisfies rig1to1/2 skeleton, socket, clip, and Golden Rule contracts`, () => {
      const { json, bin } = parseGlb(row.url);
      const ex = (json.scenes?.[0]?.extras ?? {}) as {
        rig?: string;
        humanoid?: { handFrame?: string };
        hit?: Record<string, number>;
        sockets?: Record<string, string>;
      };
      expect(typeof ex.rig === 'string' && ex.rig.startsWith('rig1to1/'), `${row.id} extras.rig`).toBe(true);
      expect(ex.humanoid?.handFrame?.startsWith(EQUIP_JOINTS_MARK), `${row.id} handFrame`).toBe(true);

      // Single skin, <= 4 influences (JOINTS_0 / WEIGHTS_0 only)
      expect(json.skins?.length ?? 0).toBe(1);
      for (const m of json.meshes ?? []) {
        for (const p of m.primitives) {
          expect(p.attributes.JOINTS_0).toBeDefined();
          expect(p.attributes.WEIGHTS_0).toBeDefined();
          expect(p.attributes.JOINTS_1).toBeUndefined();
          expect(p.attributes.WEIGHTS_1).toBeUndefined();
        }
      }

      // Nodes strictly conform to our clean rig naming contract
      const nodes = json.nodes ?? [];
      const skinJointNames = new Set((json.skins![0]!.joints ?? []).map((idx) => nodes[idx]?.name ?? ''));
      for (const n of nodes) {
        const name = n.name ?? '';
        if (name.length > 0) {
          expect(ALLOWED_NODE_NAME.test(name), `${row.id} unexpected node ${name}`).toBe(true);
        }
      }

      // Every manifest socket exists in skin.joints
      for (const [k, v] of Object.entries(row.sockets ?? {})) {
        expect(skinJointNames.has(v), `${row.id} socket ${k}->${v} in skin.joints`).toBe(true);
      }

      // Animation names & extras.hit match manifest
      const anims = json.animations ?? [];
      expect(anims.map((a) => a.name).sort()).toEqual(Object.keys(row.clips).sort());
      if (row.hit) {
        for (const [k, v] of Object.entries(row.hit)) {
          expect(ex.hit?.[k], `${row.id} hit.${k}`).toBeCloseTo(v, 3);
        }
      }

      // Track integrity: no scale tracks, no socket tracks, durations +-1.5ms, >=30 keys/s, loop seam, max step <= 60 deg
      const cache = new Map<number, Uint8Array>();
      for (const a of anims) {
        const meta = row.clips[a.name]!;
        let dur = 0;
        for (const ch of a.channels) {
          expect(ch.target.path, `${row.id} ${a.name} no scale track`).not.toBe('scale');
          const targetName = nodes[ch.target.node ?? -1]?.name ?? '';
          expect(EQUIP_NAMES.has(targetName), `${row.id} ${a.name} equip joint ${targetName} has track`).toBe(false);
          const smp = a.samplers[ch.sampler]!;
          const times = readFloats(json, bin, smp.input, cache);
          const vals = readFloats(json, bin, smp.output, cache);
          const tEnd = times[times.length - 1] ?? 0;
          dur = Math.max(dur, tEnd);
          if (ch.target.path === 'rotation') {
            const fps = tEnd > 0 ? (times.length - 1) / tEnd : 30;
            expect(fps, `${row.id} ${a.name} ${targetName} rate`).toBeGreaterThanOrEqual(29.5);
            if (meta.loop && times.length >= 2) {
              const seamDeg = quatAngleDeg(vals, 0, vals, (times.length - 1) * 4);
              expect(seamDeg, `${row.id} ${a.name} ${targetName} loop seam`).toBeLessThanOrEqual(0.5);
            }
            for (let i = 1; i < times.length; i++) {
              const step = quatAngleDeg(vals, (i - 1) * 4, vals, i * 4);
              expect(step, `${row.id} ${a.name} ${targetName} step@${i}`).toBeLessThanOrEqual(60.5);
            }
          } else if (ch.target.path === 'translation' && meta.loop && times.length >= 2) {
            const last = (times.length - 1) * 3;
            const d = Math.hypot(vals[0]! - vals[last]!, vals[1]! - vals[last + 1]!, vals[2]! - vals[last + 2]!);
            expect(d, `${row.id} ${a.name} ${targetName} loop trans seam`).toBeLessThanOrEqual(0.002);
          }
        }
        expect(Math.abs(dur - meta.duration), `${row.id} ${a.name} duration`).toBeLessThanOrEqual(0.002);
      }
    });
  }
});
