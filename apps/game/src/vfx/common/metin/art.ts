// Sprites of the metin stone effects (common VFX target `metin`; owner: the metin builder). Everything here is OUR art from the shared

// Every sprite id uses our own vfx_ art set. A missing sprite
// draws the procedural `fallback` role (spec/README.md "Art roles"), so nothing in here can break a spec.
//
// Straight-alpha sprites (`*`) keep their colour on bright floors; the others are additive on black (the colour curves tint them).
// Sprites still to be generated (codex $imagegen was paused while this was built) are listed in

import type { KitArt } from '../../emit';
import type { ArtTex, FxSpec, ParticleSpec } from '../../spec/types';
import { SPR } from '../../textures';

// ---- smoke (alpha: dark bodies that survive snow) ----------------------------------------------------------------------------------

export const ART_SMOKE_BALL: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke2' };
/** grainy dusty clump with a speckled edge (alpha) */
export const ART_DUST_CLUMP: ArtTex = { art: 'vfx_smoke_dustclump_a', fallback: 'smoke1' };
/** sparse wispy dust puff (alpha) */
export const ART_DUST_PUFF: ArtTex = { art: 'vfx_smoke_dustpuff_a', fallback: 'dust' };
/** soft round dark mass, no rim (alpha) */
export const ART_SMOKE_MASS: ArtTex = { art: 'vfx_puff_energy_dark_a', fallback: 'smoke0' };
/** ONE random frame per puff: four different billowing / clumped smoke masses (alpha) */
export const SMOKE_BODY_IDS = ['vfx_smoke_lumpball_a', 'vfx_smoke_dustclump_a', 'vfx_puff_energy_dark_a', 'vfx_smoke_dustclump_a'] as const;

// ---- smoke / cloud (additive: lit, glowing smoke) ----------------------------------------------------------------------------------

export const ART_CLOUD: ArtTex = { art: 'vfx_cloud_puff_mottled_a', fallback: 'cloud' };
/** fine grained puff with a faint speckled rim */
export const ART_CLOUD_SOFT: ArtTex = { art: 'vfx_smoke_puff_faint_a', fallback: 'cloud' };

export const ART_WISP_BALL: ArtTex = { art: 'vfx_wisp_swirl_ball_a', fallback: 'wisp' };

export const ART_WISP_TANGLE: ArtTex = { art: 'vfx_wisp_tangle_a', fallback: 'wisp' };
/** a few loose curling threads of smoke */
export const ART_WISP_THREADS: ArtTex = { art: 'vfx_wisp_smoke_threads_a', fallback: 'wisp' };
/** one curl stroke (S-shaped smoke wisp) */
export const ART_CURL: ArtTex = { art: 'vfx_curl_s_thin_a', fallback: 'swirlRing' };
/** swirling smoke ring with ragged strands, empty hub */
export const ART_VORTEX_RING: ArtTex = { art: 'vfx_vortex_smoke_ring_a', fallback: 'swirl2' };

export const ART_RING_RAGGED: ArtTex = { art: 'vfx_ring_smoke_ragged_a', fallback: 'ringCloud' };
/** soft dim ground haze (round) */
export const ART_HAZE: ArtTex = { art: 'vfx_smoke_haze_dim_a', fallback: 'cloud' };

// ---- fire -------------------------------------------------------------------------------------------------------------------------
/** lobed flame blob, orange-baked */
export const ART_FLAME_BLOB: ArtTex = { art: 'vfx_flame_blob_lobed_a', fallback: 'cloud' };
/** billowing fire puff, grey (tintable) */
export const ART_FIRE_BILLOW: ArtTex = { art: 'vfx_puff_fire_billow_a', fallback: 'cloud' };
/** slim licking tongues of flame (upright) */
export const ART_FLAME_TONGUES: ArtTex = { art: 'vfx_flame_wisps_slim_a', fallback: 'tufts' };
/** vertical fire gradient: a column shell (upright) */
export const ART_FLAME_SHELL: ArtTex = { art: 'vfx_flame_shell_gradient_a', fallback: 'streakSoft' };
/** ember-speckled flame ball */
export const ART_EMBER_BALL: ArtTex = { art: 'vfx_flame_ball_ember_a', fallback: 'ember' };
/** a speck of burnt grain scatter */
export const ART_BURN_SCATTER: ArtTex = { art: 'vfx_burn_scatter_a', fallback: 'ember' };


/** the burning column of the falling stone: lumpy fire rings stacked up a dark column with orange chips (portrait 2:3, colour baked, additive) */
export const ART_FIRE_COLUMN: ArtTex = { art: 'vfx_metin_fire_column', fallback: 'streakSoft' };
/** corruption smoke: one cloud of curling filaments with feathered tails (neutral grey, tinted by the rune colour, additive) */
export const ART_WISP_CURL: ArtTex = { art: 'vfx_metin_wisp_curl', fallback: 'wisp' };
/** the crash: ONE coherent dark red-brown smoke ball, billowing lobes with glowing ember seams (straight alpha, colour baked) */
export const ART_CRASH_SMOKE: ArtTex = { art: 'vfx_metin_crash_smoke', fallback: 'smoke2' };

// ---- light --------------------------------------------------------------------------------------------------------------------------
/** soft hot core, white centre fading to a wide halo, no rim */
export const ART_HOTCORE: ArtTex = { art: 'vfx_glow_hotcore_a', fallback: 'glowCore' };
/** hot core with a faint grainy haze */
export const ART_HOTCORE_HAZE: ArtTex = { art: 'vfx_lens_hotcore_haze_a', fallback: 'glowCore' };
/** tight orb with soft edge */
export const ART_ORB: ArtTex = { art: 'vfx_glow_orb_core_a', fallback: 'glow' };
/** pin-sized bright core */
export const ART_PIP: ArtTex = { art: 'vfx_glow_pip_core_a', fallback: 'spark' };
/** round dim floor glow (ground) */
export const ART_DISC_DIM: ArtTex = { art: 'vfx_disc_glow_dim_a', fallback: 'disc' };
/** warm floor glow (ground) */
export const ART_DISC_WARM: ArtTex = { art: 'vfx_disc_warm_floor_a', fallback: 'disc' };

// ---- rays / streaks ---------------------------------------------------------------------------------------------------------------

export const ART_BURST_FIRE: ArtTex = { art: 'vfx_burst_fire_rays_a', fallback: 'rays' };
/** ember-red star burst */
export const ART_BURST_EMBER: ArtTex = { art: 'vfx_burst_rays_ember_a', fallback: 'rays' };
/** fine needle star: many hair-thin long rays (the green laser lines of metinstone_laser) */
export const ART_NEEDLES: ArtTex = { art: 'vfx_burst_needles_a', fallback: 'fanLines' };
/** taper-ended radial rays */
export const ART_RAYS_TAPER: ArtTex = { art: 'vfx_rays_taper_burst_a', fallback: 'rays' };
/** dense ray star around a bright centre */
export const ART_RAYS_DENSE: ArtTex = { art: 'vfx_flare_rays_dense_a', fallback: 'flare' };
/** radial spikes on the ground around a dark hub (ground) */
export const ART_GROUND_BURST: ArtTex = { art: 'vfx_rayring_ground_burst_a', fallback: 'raysSoft' };
/** hair-thin streak (stretched sparks) */
export const ART_STREAK_NEEDLE: ArtTex = { art: 'vfx_streak_needle_a', fallback: 'streakSoft' };
/** four point cross with thin arms */
export const ART_STAR_CROSS: ArtTex = { art: 'vfx_star_cross_thin_a', fallback: 'flare4' };
/** upward sprayed spark streaks */
export const ART_SPRAY_UP: ArtTex = { art: 'vfx_spray_up_streaks_a', fallback: 'splashSpike' };

// ---- rings ------------------------------------------------------------------------------------------------------------------------
/** grainy ring band, no hairline (ground) */
export const ART_RING_GRAINY: ArtTex = { art: 'vfx_ring_grainy_band_a', fallback: 'ringThick' };
/** fine shock ring: grainy rim with radial streaks inside (ground) */
export const ART_RING_SHOCK: ArtTex = { art: 'vfx_ring_shock_streak_a', fallback: 'ringInner' };
/** soft thick band (ground) */
export const ART_RING_SOFT: ArtTex = { art: 'vfx_ring_soft_band_b', fallback: 'ringThick' };
/** thick radial ring, dark hub (ground) */
export const ART_RING_THICK: ArtTex = { art: 'vfx_ring_thick_radial_a', fallback: 'ringThick' };
/** bubble haze ring (ground, faint) */
export const ART_RING_HAZE: ArtTex = { art: 'vfx_ring_bubble_haze_a', fallback: 'ringCloud' };

// ---- debris / ground ----------------------------------------------------------------------------------------------------------------
/** facet-cut rock chunk, lit (alpha) */
export const ART_ROCK_FACET: ArtTex = { art: 'vfx_rock_chunk_facet_a', fallback: 'shard1' };
/** lumpy rock (alpha) */
export const ART_ROCK_LUMPY: ArtTex = { art: 'vfx_debris_rock_lumpy_a', fallback: 'shard1' };
/** branching scorched crack with ember seam (alpha, ground) */
export const ART_CRACK_SCAR: ArtTex = { art: 'vfx_crack_thorn_scorch_a', fallback: 'crack' };

// ---- glyph / carpet ------------------------------------------------------------------------------------------------------------------
/** engraved stone medallion with glyph sectors (filled rune carpet) */
export const ART_MEDALLION: ArtTex = { art: 'vfx_medallion_sectors_a', fallback: 'runeCircle' };
/** dense ornate swirl mandala (ring of scroll glyphs) */
export const ART_ORNATE_SWIRL: ArtTex = { art: 'vfx_ring_ornate_swirl_a', fallback: 'runeCircle' };

/** every shipped sprite id the metin specs draw (guard test: each must exist in the manifest) */
export const METIN_ART_IDS: readonly string[] = [
  ...new Set([
    ...SMOKE_BODY_IDS,
    'vfx_smoke_dustpuff_a',
    'vfx_cloud_puff_mottled_a',
    'vfx_smoke_puff_faint_a',
    'vfx_wisp_swirl_ball_a',
    'vfx_wisp_tangle_a',
    'vfx_wisp_smoke_threads_a',
    'vfx_curl_s_thin_a',
    'vfx_vortex_smoke_ring_a',
    'vfx_ring_smoke_ragged_a',
    'vfx_smoke_haze_dim_a',
    'vfx_flame_blob_lobed_a',
    'vfx_puff_fire_billow_a',
    'vfx_flame_wisps_slim_a',
    'vfx_flame_shell_gradient_a',
    'vfx_flame_ball_ember_a',
    'vfx_burn_scatter_a',
    'vfx_glow_hotcore_a',
    'vfx_lens_hotcore_haze_a',
    'vfx_glow_orb_core_a',
    'vfx_glow_pip_core_a',
    'vfx_disc_glow_dim_a',
    'vfx_disc_warm_floor_a',
    'vfx_burst_fire_rays_a',
    'vfx_burst_rays_ember_a',
    'vfx_burst_needles_a',
    'vfx_rays_taper_burst_a',
    'vfx_flare_rays_dense_a',
    'vfx_rayring_ground_burst_a',
    'vfx_streak_needle_a',
    'vfx_star_cross_thin_a',
    'vfx_spray_up_streaks_a',
    'vfx_ring_grainy_band_a',
    'vfx_ring_shock_streak_a',
    'vfx_ring_soft_band_b',
    'vfx_ring_thick_radial_a',
    'vfx_ring_bubble_haze_a',
    'vfx_rock_chunk_facet_a',
    'vfx_debris_rock_lumpy_a',
    'vfx_crack_thorn_scorch_a',
    'vfx_medallion_sectors_a',
    'vfx_ring_ornate_swirl_a',
    'vfx_metin_fire_column',
    'vfx_metin_wisp_curl',
    'vfx_metin_crash_smoke',
  ]),
];

/** sprites the CLASSIC presets (presets.ts) draw through `PBuilder.art` (fallback = the procedural atlas cell while the sprite is not packed) */
export const MA = {
  smokeBall: { id: 'vfx_smoke_lumpball_a', fb: SPR.smoke2 },
  dustClump: { id: 'vfx_smoke_dustclump_a', fb: SPR.smoke1 },
  dustPuff: { id: 'vfx_smoke_dustpuff_a', fb: SPR.smoke0 },
  smokeMass: { id: 'vfx_puff_energy_dark_a', fb: SPR.smoke0 },
  cloud: { id: 'vfx_cloud_puff_mottled_a', fb: SPR.cloud },
  wispBall: { id: 'vfx_wisp_swirl_ball_a', fb: SPR.wisp },
  wispTangle: { id: 'vfx_wisp_tangle_a', fb: SPR.wisp },
  wispThreads: { id: 'vfx_wisp_smoke_threads_a', fb: SPR.wisp },
  curl: { id: 'vfx_curl_s_thin_a', fb: SPR.wisp },
  vortexRing: { id: 'vfx_vortex_smoke_ring_a', fb: SPR.wisp },
  flameBlob: { id: 'vfx_flame_blob_lobed_a', fb: SPR.glow },
  fireBillow: { id: 'vfx_puff_fire_billow_a', fb: SPR.glow },
  flameTongues: { id: 'vfx_flame_wisps_slim_a', fb: SPR.flame0 },
  flameShell: { id: 'vfx_flame_shell_gradient_a', fb: SPR.streakSoft },
  emberBall: { id: 'vfx_flame_ball_ember_a', fb: SPR.ember0 },
  hotCore: { id: 'vfx_glow_hotcore_a', fb: SPR.glowTight },
  hotHaze: { id: 'vfx_lens_hotcore_haze_a', fb: SPR.glowTight },
  pip: { id: 'vfx_glow_pip_core_a', fb: SPR.glowTight },
  burstFire: { id: 'vfx_burst_fire_rays_a', fb: SPR.sunburst },
  burstEmber: { id: 'vfx_burst_rays_ember_a', fb: SPR.sunburst },
  needles: { id: 'vfx_burst_needles_a', fb: SPR.sunburst },
  raysTaper: { id: 'vfx_rays_taper_burst_a', fb: SPR.sunburst },
  raysDense: { id: 'vfx_flare_rays_dense_a', fb: SPR.sunburst },
  groundBurst: { id: 'vfx_rayring_ground_burst_a', fb: SPR.sunburst },
  streakNeedle: { id: 'vfx_streak_needle_a', fb: SPR.streak },
  sprayUp: { id: 'vfx_spray_up_streaks_a', fb: SPR.streak },
  starCross: { id: 'vfx_star_cross_thin_a', fb: SPR.glint },
  ringGrainy: { id: 'vfx_ring_grainy_band_a', fb: SPR.ringThin },
  ringShock: { id: 'vfx_ring_shock_streak_a', fb: SPR.ringThin },
  rockFacet: { id: 'vfx_rock_chunk_facet_a', fb: SPR.shard },
  rockLumpy: { id: 'vfx_debris_rock_lumpy_a', fb: SPR.shard },
  medallion: { id: 'vfx_medallion_sectors_a', fb: SPR.glow },
} as const satisfies Record<string, KitArt>;

/** one never-drawn element per sprite (rate 0, alpha 0): compile collects its art key, so the run packs it for the classic presets */
function carrier(id: string): ParticleSpec {
  return {
    kind: 'particle',
    note: `art carrier: keeps ${id} in the run's art scope for the classic metin presets (never drawn)`,
    cycle: 1,
    max: 1,
    rate: [0, 0],
    life: [0, 1],
    half: [0, 0.1],
    color: [0, 0xffffff, 0, 1, 0xffffff, 0],
    billboard: 'screen',
    blend: 'add',
    tex: { art: id, fallback: 'glow' },
  };
}

const CLASSIC_IDS = [...new Set(Object.values(MA).map((a) => a.id))];

/** `sk.gen.metin_art`: art-scope carrier for the classic presets (metin.fall / impact / awaken / shatter); never spawned (spec elements are capped at 16, so one carrier per 16 sprites) */
export const METIN_ART_SPECS: FxSpec[] = Array.from({ length: Math.ceil(CLASSIC_IDS.length / 16) }, (_, k) => ({
  id: k === 0 ? 'sk.gen.metin_art' : `sk.gen.metin_art${k + 1}`,
  desc: 'art-scope carrier for the classic metin presets sprites; never spawned',
  behavior: 'selfBuff' as const,
  ref: { family: 'metin art carrier', notes: 'see vfx/common/metin/art.ts' },
  size: 'radius' as const,
  base: 1,
  dur: 0.1,
  elements: CLASSIC_IDS.slice(k * 16, k * 16 + 16).map(carrier),
}));
