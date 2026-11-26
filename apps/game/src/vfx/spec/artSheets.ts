// Named flipbook sheets made of separate generated sprites (pure data: no three.js, usable from specs, tests and tools).
//

// exist as several sprites. A spec lists them as ONE art key and the loader packs them into consecutive cells of the art
// array (art.ts), so they animate exactly like a procedural flipbook:
//
//   tex: { art: ART_SHEETS.boltWavyH, fallback: 'boltH' }, frames: { fps: 12, mode: ART_SHEET_PLAY.boltWavyH.mode }
//
// Two kinds of entry:


//    `random_frame` draws a new random entry every step (play with mode 'random'; the order does not matter).

//    and means nothing: draw them with mode 'random', or pick one of them.

// contract: a sheet only ever packs the frames its spec asks for, so one sheet costs `frames` cells of the art array,

// the order of its source element, and every pool to its member set.
import type { FrameMode } from './types';

export const ART_SHEETS = {
  // ------------------------------------------------------------------------------------------ sequences
  /** 6 white vertical bolts, 256² (shaman 0001-0006, random_frame; procedural counterpart `boltV`) */
  boltFlickerV: ['vfx_bolt_flicker_v_a', 'vfx_bolt_flicker_v_b', 'vfx_bolt_flicker_v_c', 'vfx_bolt_flicker_v_d', 'vfx_bolt_flicker_v_e', 'vfx_bolt_flicker_v_f'],
  /** 6 white horizontal bolts, 256² (shaman r0001-r0006, random_frame; `boltH`) */
  boltWavyH: ['vfx_bolt_wavy_h_1', 'vfx_bolt_wavy_h_2', 'vfx_bolt_wavy_h_3', 'vfx_bolt_wavy_h_4', 'vfx_bolt_wavy_h_5', 'vfx_bolt_wavy_h_6'],
  /** 3 vertical bolts (fork, zigzag, braid), 512² (warrior 17_1-17_3, random_frame; `boltV`) */
  boltForkV: ['vfx_bolt_fork_v_a', 'vfx_bolt_zig_v_a', 'vfx_bolt_braid_v_a'],
  /** 4 blue-white arcs, 512² (the light_*_body effects' first element: wide b, c, d, then a; cw 0.024 s; `boltH`) */
  boltBlowBodyH: ['vfx_bolt_arc_wide_b', 'vfx_bolt_arc_wide_c', 'vfx_bolt_arc_wide_d', 'vfx_bolt_arc_wide_a'],
  /** 3 blue-white arcs, 512² (light_1/2/3_body's second element: wide a, twin b, twin a; cw 0.024 s; `boltH`) */
  boltBlowTwinH: ['vfx_bolt_arc_wide_a', 'vfx_bolt_arc_twin_b', 'vfx_bolt_arc_twin_a'],
  /** 4 blue-white arcs, 512² (the light_*_weapon effects' first element: wide b, wide d, twin a, twin b; cw 0.024 s; `boltH`) */
  boltBlowWeaponH: ['vfx_bolt_arc_wide_b', 'vfx_bolt_arc_wide_d', 'vfx_bolt_arc_twin_a', 'vfx_bolt_arc_twin_b'],
  
  /** POOL of the 6 blue-white horizontal electric arcs, 512² (twin a/b, wide a-d; the sequences above use subsets of it; `boltH`) */
  boltBlowH: ['vfx_bolt_arc_twin_a', 'vfx_bolt_arc_twin_b', 'vfx_bolt_arc_wide_a', 'vfx_bolt_arc_wide_b', 'vfx_bolt_arc_wide_c', 'vfx_bolt_arc_wide_d'],
  
  boltForkH: ['vfx_bolt_fork_h_a', 'vfx_bolt_zig_h_a'],
} as const satisfies Record<string, readonly string[]>;

export type ArtSheetName = keyof typeof ART_SHEETS;


export const ART_SHEET_POOLS = ['boltBlowH', 'boltForkH'] as const satisfies readonly ArtSheetName[];





export const ART_SHEET_PLAY: Readonly<Record<ArtSheetName, { readonly mode: FrameMode; readonly fps?: number }>> = {
  boltFlickerV: { mode: 'random' },
  boltWavyH: { mode: 'random' },
  boltForkV: { mode: 'random' },
  boltBlowBodyH: { mode: 'cut', fps: 1 / 0.024 },
  boltBlowTwinH: { mode: 'cut', fps: 1 / 0.024 },
  boltBlowWeaponH: { mode: 'cut', fps: 1 / 0.024 },
  boltBlowH: { mode: 'random' },
  boltForkH: { mode: 'random' },
};
