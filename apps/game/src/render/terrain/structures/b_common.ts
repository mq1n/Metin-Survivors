// Shared palette + helpers for the set-B structure builders.
import { Color, Vector3 } from 'three';
import { MeshBuilder } from './b_geom';
import { structureMaterial, type StructureMatOpts } from './b_mat';
import type { StructureBuildContext, StructurePart } from './types';

/** painterly base palette (sRGB hex); builders tint these through MeshBuilder.set */
export const PAL = {
  woodMid: '#7b644e',
  woodDark: '#45392d',
  woodLight: '#a38868',
  woodGrey: '#756b5c',
  barkDark: '#4f3b2b',
  rope: '#b69c63',
  ropeDark: '#7c6740',
  iron: '#3a3a40',
  ironLight: '#5b5b63',
  bronze: '#a26f2d',
  bronzeDark: '#5d3f1c',
  stone: '#9b968a',
  stoneDark: '#68655d',
  moss: '#5b7a3b',
  clay: '#a35e39',
  clayDark: '#6c3a25',
  cream: '#d8c496',
  straw: '#cfae52',
  strawDark: '#8e7230',
  hide: '#a98559',
  hideDark: '#6e5234',
  hideLight: '#c9a877',
  bone: '#d9cfb3',
  boneDark: '#9c9275',
  red: '#8e211b',
  redDark: '#561412',
  black: '#1c1613',
  gold: '#d4a73a',
  goldDark: '#8c6a1f',
  cloth: '#7a1a1a',
  felt: '#c8bba4',
  snow: '#eef3f8',
  snowShade: '#b9c8d8',
} as const;

/** multiplies a hex colour's brightness */
export function tint(hex: string, k: number): Color {
  return new Color(hex).multiplyScalar(k);
}

/** random brightness-jittered variant of a palette colour */
export function vary(hex: string, rng: () => number, amount = 0.18): Color {
  return new Color(hex).multiplyScalar(1 - amount + rng() * amount * 2);
}

/** zone dressing for stonework (walls, stone bridges): detail texture, accent colours and a colour multiplier */
export interface StoneLook {
  /** detail texture id sampled by the stone material slot */
  tex: string;
  /** colour blended into the stone body (moss / snow shade / soot-rust) */
  accent: string;
  /** colour blended into coping stones and caps, and how strongly */
  cap: string;
  capBlend: number;
  /** linear multiplier on every stone colour */
  mul: Color;
  /** faint glowing seams in the cracks (lava zone) */
  embers: boolean;
}

const LOOK_DEFAULT: StoneLook = { tex: 'tex_rock_mossy', accent: PAL.moss, cap: PAL.moss, capBlend: 0.4, mul: new Color(1, 1, 1), embers: false };
const STONE_LOOKS: Record<string, StoneLook> = {
  seori: { tex: 'tex_rock_frozen', accent: PAL.snowShade, cap: PAL.snow, capBlend: 0.8, mul: new Color(1, 1, 1), embers: false },
  daeryeol: { tex: 'tex_basalt', accent: '#4a2418', cap: '#2a1b16', capBlend: 0.5, mul: new Color(0.36, 0.3, 0.28), embers: true },
};

export const stoneLook = (zone: string): StoneLook => STONE_LOOKS[zone] ?? LOOK_DEFAULT;

/** a stone colour as it appears in the zone */
export const toned = (look: StoneLook, c: string | Color): Color => new Color(c).multiply(look.mul);

export function solidPart(mb: MeshBuilder, ctx: StructureBuildContext, o?: StructureMatOpts, castShadow = true): StructurePart {
  return { geometry: mb.build(), material: structureMaterial(ctx, o), castShadow };
}

/** twisted-rope tube: stripes alternate along the length so a 3-sided tube still reads as rope */
export function rope(mb: MeshBuilder, path: readonly Vector3[], r: number, o: { twist?: number; sway?: (t: number) => number } = {}): void {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += (path[i] as Vector3).distanceTo(path[i - 1] as Vector3);
  const twist = o.twist ?? 1 / 0.07;
  mb.tube(path, r, {
    radial: 4,
    cap0: 'flat',
    cap1: 'flat',
    shade: (t, a) => 0.82 + 0.28 * (0.5 + 0.5 * Math.sin((t * len * twist + a * 2) * Math.PI * 2 * 0.5)),
    sway: o.sway,
  });
}

/** points of a closed rounded rectangle loop (rope around a crate), centred on (0,y,0) */
export function roundedLoop(hw: number, hd: number, y: number, rad: number, perCorner = 3): Vector3[] {
  const pts: Vector3[] = [];
  const corners: Array<[number, number, number]> = [
    [hw - rad, hd - rad, 0],
    [-(hw - rad), hd - rad, Math.PI / 2],
    [-(hw - rad), -(hd - rad), Math.PI],
    [hw - rad, -(hd - rad), Math.PI * 1.5],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + ((Math.PI / 2) * i) / perCorner;
      pts.push(new Vector3(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad));
    }
  }
  pts.push((pts[0] as Vector3).clone());
  return pts;
}

export const TAU = Math.PI * 2;
