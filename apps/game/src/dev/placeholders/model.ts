// DEV-only: turns built geometry + rig + clips into a PlaceholderModel that obeys the FORGE GLB contract (§5.1).
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  type AnimationClip,
  type BufferGeometry,
  type Skeleton,
} from 'three';
import type { ClipInfo, ModelAsset, ModelKind } from '../../data/assetManifest';
import type { PlaceholderModel } from '../../engine/assets';
import type { Rig } from './rig';

export const LOOP_CLIPS: Record<string, true> = { idle: true, walk: true, run: true, pulse: true };

export function makeMaterial(kind: ModelKind): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: kind === 'weapon' ? 0.45 : 0.82, metalness: kind === 'weapon' ? 0.45 : 0.02 });
  m.name = `placeholder_${kind}`;
  return m;
}

export interface ModelInput {
  id: string;
  kind: ModelKind;
  parts: { name: string; geometry: BufferGeometry }[];
  rig?: Rig;
  clips?: AnimationClip[];
  hit?: Record<string, number>;
  sockets?: Record<string, string>;
  height: number;
  radius: number;
  palette: string[];
  extra?: Record<string, unknown>;
}

function trisOf(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
}

function bytesOf(g: BufferGeometry, skinned: boolean): number {
  const verts = g.getAttribute('position')?.count ?? 0;
  // meshopt-quantised estimate: pos 8 + nrm 4 + col 4 (+ joints 4 + weights 4) per vertex, indices ~1.1 B each
  return Math.round(verts * (skinned ? 24 : 16) + trisOf(g) * 3.3);
}

/** Builds the Group with (optionally) a skeleton shared by every skinned part. */
export function assembleModel(inp: ModelInput): PlaceholderModel {
  const scene = new Group();
  scene.name = inp.id;
  const material = makeMaterial(inp.kind);
  let skeleton: Skeleton | null = null;
  if (inp.rig) skeleton = inp.rig.createSkeleton(scene);
  let tris = 0;
  let bytes = 0;
  for (const part of inp.parts) {
    tris += trisOf(part.geometry);
    bytes += bytesOf(part.geometry, skeleton !== null);
    if (skeleton) {
      const mesh = new SkinnedMesh(part.geometry, material);
      mesh.name = part.name;
      mesh.frustumCulled = false;
      scene.add(mesh);
      mesh.bind(skeleton, mesh.matrixWorld);
    } else {
      const mesh = new Mesh(part.geometry, material);
      mesh.name = part.name;
      scene.add(mesh);
    }
  }
  scene.updateMatrixWorld(true);
  const clips = inp.clips ?? [];
  const clipInfo: Record<string, ClipInfo> = {};
  let animBytes = 0;
  for (const c of clips) {
    clipInfo[c.name] = { duration: Math.round(c.duration * 1000) / 1000, loop: LOOP_CLIPS[c.name] === true };
    for (const t of c.tracks) animBytes += t.values.length * 2 + t.times.length * 2;
  }
  const hit = inp.hit ?? {};
  const sockets = inp.sockets ?? {};
  const height = Math.round(inp.height * 1000) / 1000;
  const radius = Math.round(inp.radius * 1000) / 1000;
  scene.userData = {
    id: inp.id,
    kind: inp.kind,
    height,
    radius,
    hit,
    sockets,
    palette: inp.palette,
    ...inp.extra,
  };
  const asset: ModelAsset = {
    id: inp.id,
    url: '',
    kind: inp.kind,
    height,
    radius,
    clips: clipInfo,
    hit,
    sockets,
    tris: Math.round(tris),
    bones: inp.rig?.count ?? 0,
    bytes: Math.round(bytes + animBytes),
    palette: inp.palette,
  };
  return { scene, clips, asset };
}
