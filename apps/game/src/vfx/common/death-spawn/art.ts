// Sprites of the death / spawn smoke (common VFX target `death-spawn`; owner: the death-spawn builder). Everything here is OUR art


// 1111) are LOOK references only. A missing sprite draws the procedural `fallback` role (spec/README.md "Art roles").
import type { ArtTex } from '../../spec/types';



export const SMOKE_SOFT_IDS = ['vfx_dust_cloud_blotchy_a', 'vfx_death_spawn_dust_blot', 'vfx_dust_cloud_blotchy_a', 'vfx_death_spawn_smoke_puff'] as const;
export const ART_SMOKE_SOFT: ArtTex = { art: SMOKE_SOFT_IDS, fallback: 'smoke0' };

/** r2: the dusty BLOTCHY puff (generated from dust copy + 77: soft lumps, grainy detached blots, uneven edge: no radial hair, no airbrushed ball) used alone for
 *  the death clouds that must keep a lumpy silhouette (elite / boss flung chunks) */
export const ART_DUST_BLOT: ArtTex = { art: ['vfx_death_spawn_dust_blot', 'vfx_dust_cloud_blotchy_a'], fallback: 'smoke0' };

/** r2: scattered dark smoke clumps (separate lumps, no disc): the grime the corrupt spawn's dirty smoke comes out of */
export const ART_GRIME: ArtTex = { art: 'vfx_smoke_cinder_puffs_a', fallback: 'smoke1' };



export const ART_VORTEX_MASS: ArtTex = { art: 'vfx_death_spawn_vortex_mass', fallback: 'smoke0' };

/** the soft puffs that are bright in the MIDDLE (the mottled / smudge ones have a dark core): the dark mass of the vortex needs a body without a hole */
export const SMOKE_MASS_IDS = ['vfx_smoke_puff_faint_a', 'vfx_smoke_haze_dim_a'] as const;
export const ART_SMOKE_MASS: ArtTex = { art: SMOKE_MASS_IDS, fallback: 'smoke0' };


export const ART_SMOKE_GRAIN: ArtTex = { art: 'vfx_death_spawn_smoke_grain', fallback: 'smoke1' };

export const ART_SMOKE_LUMP: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke2' };


export const ART_VORTEX_DISC: ArtTex = { art: 'vfx_death_spawn_vortex_disc', fallback: 'swirl2' };

export const ART_VORTEX_STRANDS: ArtTex = { art: 'vfx_vortex_smoke_ring_a', fallback: 'swirl2' };


export const ART_VORTEX_ARCS: ArtTex = { art: 'vfx_death_spawn_vortex_arcs', fallback: 'swirl2' };


export const ART_LIT_RING: ArtTex = { art: 'vfx_death_spawn_lit_ring', fallback: 'ringCloud' };

export const ART_RIM_ARCS: ArtTex = { art: 'vfx_ring_arcs_facing_a', fallback: 'arcPair' };
/** ragged smoke ring, empty hub (the dim rim at the end of the appear) */
export const ART_RING_RAGGED: ArtTex = { art: 'vfx_ring_smoke_ragged_a', fallback: 'ringCloud' };

export const ART_SPECK: ArtTex = { art: 'vfx_glow_fuzzball_a', fallback: 'dot' };

/** every shipped sprite id this target draws (guard test: they must exist in the manifest) */
export const DEATH_SPAWN_ART_IDS: readonly string[] = [
  ...SMOKE_SOFT_IDS,
  'vfx_death_spawn_vortex_mass',
  'vfx_smoke_cinder_puffs_a',
  ...SMOKE_MASS_IDS,
  'vfx_death_spawn_smoke_grain',
  'vfx_death_spawn_vortex_disc',
  'vfx_death_spawn_vortex_arcs',
  'vfx_death_spawn_lit_ring',
  'vfx_smoke_lumpball_a',
  'vfx_vortex_smoke_ring_a',
  'vfx_ring_arcs_facing_a',
  'vfx_ring_smoke_ragged_a',
  'vfx_glow_fuzzball_a',
];
