// Rigid-piece rig for metin stones: every piece (fracture chunk, floating shard, rubble, core) is one bone parented to `root`
// at the piece centroid. Rest rotations are identity, so clip translations are world-space offsets from the rest pose.
import type { Vec3 } from '../../core/math.ts';
import { Skeleton } from '../../core/skin/skeleton.ts';
import type { Poly } from '../../core/ext/metins/poly.ts';

export type PieceRole = 'chunk' | 'shard' | 'debris' | 'core';

export interface Orbit {
  /** orbit radius about the Y axis through (cx, cz) */
  r: number;
  /** start angle (rad) */
  a0: number;
  /** revolutions per idle loop (signed) */
  turns: number;
  /** vertical bob amplitude (m) and cycles per idle loop */
  bob: number;
  bobCycles: number;
  /** self-spin revolutions per idle loop */
  spin: number;
  /** tilt wobble amplitude in rad (default 0.18) */
  wob?: number;
  cx?: number;
  cz?: number;
}

export interface PieceDef {
  role: PieceRole;
  polys: Poly[];
  /** painter group (hull / part id) */
  part: number;
  orbit?: Orbit;
  /** explicit shatter strength multiplier (default 1) */
  kick?: number;
  /** R2: a thin / tiny chunk that vanishes at the shatter start instead of flying */
  sliver?: boolean;
  /** hover bob applied in idle (cycles per idle loop) and, softened, in pulse */
  bob?: { amp: number; cycles: number; phase?: number };
}

export interface Piece extends PieceDef {
  bone: number;
  name: string;
  c: Vec3;
  /** unit radial direction from the stone axis (xz) */
  radial: Vec3;
  /** 0..1 height of the centroid within the model */
  h: number;
  /** bounding radius of the piece about its centroid */
  rad: number;
  /** lowest point relative to the centroid (<= 0) */
  low: number;
  /** r6 (static route): support points of the piece about its centroid (the rotation-aware ground test of ClipTune.contact) */
  hull?: Vec3[];
}

export interface Rig {
  skeleton: Skeleton;
  pieces: Piece[];
  height: number;
}

const PREFIX: Record<PieceRole, string> = { chunk: 'chunk', shard: 'shard', debris: 'frag', core: 'core' };

export function buildRig(defs: readonly PieceDef[]): Rig {
  let height = 0;
  const infos = defs.map((d) => {
    let c: Vec3 = [0, 0, 0], n = 0;
    let minY = Infinity;
    for (const p of d.polys) {
      for (const v of p.vertices()) { c = [c[0] + v[0], c[1] + v[1], c[2] + v[2]]; n++; minY = Math.min(minY, v[1]); height = Math.max(height, v[1]); }
    }
    c = [c[0] / n, c[1] / n, c[2] / n];
    let rad = 0;
    for (const p of d.polys) for (const v of p.vertices()) rad = Math.max(rad, Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]));
    return { c, rad, low: minY - c[1] };
  });
  const counters: Record<PieceRole, number> = { chunk: 0, shard: 0, debris: 0, core: 0 };
  const bones = [{ name: 'root', parent: null as string | null, pos: [0, 0, 0] as Vec3 }];
  const pieces: Piece[] = defs.map((d, i) => {
    const name = `${PREFIX[d.role]}_${String(counters[d.role]++).padStart(2, '0')}`;
    const inf = infos[i]!;
    bones.push({ name, parent: 'root', pos: inf.c });
    const rl = Math.hypot(inf.c[0], inf.c[2]);
    const radial: Vec3 = rl > 0.05 ? [inf.c[0] / rl, 0, inf.c[2] / rl] : [Math.cos(i * 2.399), 0, Math.sin(i * 2.399)];
    return { ...d, bone: bones.length - 1, name, c: inf.c, radial, h: 0, rad: inf.rad, low: inf.low };
  });
  for (const p of pieces) p.h = Math.min(1, Math.max(0, p.c[1] / Math.max(height, 1e-6)));
  return { skeleton: new Skeleton(bones), pieces, height };
}
