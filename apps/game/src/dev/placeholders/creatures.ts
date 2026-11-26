// DEV-only: creature archetype dispatch (quadruped | humanoid | brute | boss) → PlaceholderModel.
import type { AnimationClip, BufferGeometry } from 'three';
import type { ModelKind } from '../../data/assetManifest';
import type { PlaceholderModel } from '../../engine/assets';
import { fitBoneBudget } from './boneBudget';
import { assembleModel } from './model';
import type { Rig } from './rig';
import { buildBiped, type BipedPreset } from './biped';
import { buildQuadruped, type QuadVariant } from './quadruped';

export type Archetype = 'quadruped' | 'humanoid' | 'brute' | 'boss';

export interface CreatureBuild {
  rig: Rig;
  parts: { name: string; geometry: BufferGeometry }[];
  clips: AnimationClip[];
  hit: Record<string, number>;
  sockets: Record<string, string>;
  height: number;
  radius: number;
  palette: string[];
  verts: number;
}

export interface CreatureOptions {
  seed: number;
  archetype: Archetype;
  /** override the species/variant picked from the seed */
  variant?: string;
  tint?: string;
  /** mesh resolution override (grid cell, m) */
  cell?: number;
  /** re-target the skeleton to this many bones (socket bones are always kept) */
  bones?: number;
}

export function buildCreature(id: string, kind: ModelKind, o: CreatureOptions): PlaceholderModel {
  let build: CreatureBuild;
  switch (o.archetype) {
    case 'quadruped':
      build = buildQuadruped(o.seed, { variant: o.variant as QuadVariant | undefined, tint: o.tint, cell: o.cell });
      break;
    case 'humanoid':
      build = buildBiped('humanoid', o.seed, { preset: o.variant as BipedPreset | undefined, tint: o.tint, cell: o.cell });
      break;
    case 'brute':
      build = buildBiped('brute', o.seed, { preset: o.variant as BipedPreset | undefined, tint: o.tint, cell: o.cell });
      break;
    case 'boss':
      build = buildBiped('boss', o.seed, { preset: o.variant as BipedPreset | undefined, tint: o.tint, cell: o.cell });
      break;
  }
  if (o.bones !== undefined) build = fitBoneBudget(build, o.bones);
  return assembleModel({
    id,
    kind,
    rig: build.rig,
    parts: build.parts,
    clips: build.clips,
    hit: build.hit,
    sockets: build.sockets,
    height: build.height,
    radius: build.radius,
    palette: build.palette,
  });
}
