import type { ClipSpec } from '../../core/anim/clip.ts';
import type { MeshSettings, PaintSpec } from '../../core/build.ts';
import type { Body } from '../../core/sdf/body.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';

/** Which spirit anatomy to build. */
export type SpiritKind = 'ice' | 'fire' | 'corpse';

export interface SpiritParams {
  id: string;
  kind: SpiritKind;
  seed: number;
  /** uniform scale of the design-space model (1 = authored height) */
  scale: number;
  /** albedo texture size (px); 0 = vertex colours only */
  texture?: number;
  voxel?: number;
  tris?: number;
}

/** What each variant module returns; index.ts turns it into a CreatureDef. */
export interface SpiritVariant {
  skeleton: Skeleton;
  body: Body;
  paint: PaintSpec;
  clips: ClipSpec[];
  mesh: MeshSettings;
  sockets: Record<string, string>;
  /** authored ground speeds (m/s) for walk / run */
  speed: { walk: number; run: number };
  /** blend of the vertex normals toward world-up (0..1): self-lit / glow look under the game's Lambert light */
  normalLift: number;
  radius?: number;
}
