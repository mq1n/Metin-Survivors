import type { ClipData } from './anim/clip.ts';
import type { Skeleton } from './skin/skeleton.ts';

export type ModelKind = 'creature' | 'boss' | 'hero' | 'weapon' | 'metin' | 'prop' | 'tree' | 'pickup';

/** Everything the GLB writer needs. Producers (SDF creature pipeline, hard-surface builders) all return this. */
export interface ModelData {
  id: string;
  kind: ModelKind;
  /** metres, Y up, +Z forward, origin on the ground */
  positions: Float32Array;
  normals: Float32Array;
  /** linear RGB, 3 floats per vertex */
  colors: Float32Array;
  indices: Uint32Array;
  /** optional TEXCOORD_0 (2 floats per vertex, V down) with its baked albedo (WebP bytes) */
  uvs?: Float32Array;
  texture?: { webp: Uint8Array; width: number; height: number };
  /** optional emissive map (sRGB RGB WebP on TEXCOORD_0 -> material.emissiveTexture); requires `uvs` */
  emissive?: { webp: Uint8Array; width: number; height: number };
  /** material.emissiveFactor. Default [1,1,1] when `emissive` is set, else untouched [0,0,0] */
  emissiveFactor?: [number, number, number];
  /** PBR overrides (defaults roughness 0.88, metallic 0) */
  material?: { roughness?: number; metallic?: number };
  /** skinning (omit for static props) */
  skin?: {
    skeleton: Skeleton;
    /** 4 per vertex */
    joints: Uint8Array;
    /** 4 per vertex, bytes summing to 255 */
    weights: Uint8Array;
  };
  clips: ClipData[];
  /** metres */
  height: number;
  /** footprint radius, metres */
  radius: number;
  /** logical socket -> bone name */
  sockets?: Record<string, string>;
  palette?: string[];
  /** extra scene extras */
  extras?: Record<string, unknown>;
}

export interface ModelStats {
  tris: number;
  bones: number;
  bytes: number;
}
