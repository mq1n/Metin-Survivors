// Sprites the boss set pieces draw (common VFX target `boss`; owner: the boss builder). All of them are shipped factory sprites (manifest kind

// grey, tinted per element by the preset. Used through the legacy kit (`PBuilder.art`), so every id must be in the run's art scope: the carrier
// specs `sk.gen.boss_art*` (specs.ts) reference them all. A missing sprite draws `fb`, its procedural atlas cell, so a preset never breaks.
// Ring sprites carry `pk` = the ring's peak radius as a share of the quad's FULL width (measured on the shipped files), so a ring of radius r is
// drawn with size r / pk.
import type { KitArt } from '../../emit';
import { SPR } from '../../textures';

export interface RingArt extends KitArt {
  /** peak radius of the ring as a share of the quad width */
  readonly pk: number;
}

export const BOSS_ART = {
  
  puffMottled: { id: 'vfx_cloud_puff_mottled_a', fb: SPR.cloud },
  puffLumpy: { id: 'vfx_cloud_lumpy_a', fb: SPR.smoke2 },
  smudge: { id: 'vfx_cloud_smudge_a', fb: SPR.smoke1 },
  puffHaze: { id: 'vfx_smoke_haze_dim_a', fb: SPR.smoke0 },
  /** r2: round hazy puff, mottled (the body of the standing smoke volumes) */
  hazeRound: { id: 'vfx_puff_haze_round_a', fb: SPR.smoke0 },
  /** r2: breath-of-wolf haze: lumpy fog ball */
  fogBall: { id: 'vfx_rimewind_haze', fb: SPR.smoke2 },
  /** r2: ragged white mass with a feathered rim (the rare dense lump in a volume) */
  mass: { id: 'vfx_death_spawn_vortex_mass', fb: SPR.smoke3 },
  
  crash: { id: 'vfx_metin_crash_smoke', fb: SPR.smoke3 },
  /** fine speckled dust / ember haze */
  dustGrain: { id: 'vfx_dust_grain_ball_a', fb: SPR.dust0 },
  emberSpeck: { id: 'vfx_cloud_ember_speckle_a', fb: SPR.ember0 },
  /** r2: soft glowing ball (the luminous core of a smoke volume) */
  hotcore: { id: 'vfx_lens_hotcore_haze_a', fb: SPR.glow },
  // ---- flames: tall ragged tongues standing side by side (enrage aura / burst), a wolf-breath fire for the short ones
  flameA: { id: 'vfx_flame_curtain_a', fb: SPR.flame0 },
  // ---- wind / speed streaks lying on the ground
  windStreak: { id: 'vfx_streak_wind_soft_a', fb: SPR.streakSoft },
  needle: { id: 'vfx_streak_needle_a', fb: SPR.streak },
  // ---- r2: light (upright): a soft wide shaft and a thin bright beam with a hot root, NOT the comb of evenly spaced hairlines
  riseSoft: { id: 'vfx_streak_rise_soft_a', fb: SPR.streakSoft },
  beam: { id: 'vfx_levelup_heal_pillar_cream', fb: SPR.streakSoft },
  // ---- r2: chips: lumpy rock, faceted ice crown (an upright crystal cluster)
  rockLumpy: { id: 'vfx_debris_rock_lumpy_a', fb: SPR.shard },
  iceCrown: { id: 'vfx_shard_ice_crown_a', fb: SPR.shard },
  starFrost: { id: 'vfx_starburst_frost_a', fb: SPR.sparkle },
  
  
  iceGem: { id: 'vfx_boss_icecrystal', fb: SPR.shard },
  
  flameAura: { id: 'vfx_boss_flameaura', fb: SPR.flame0 },
  
  /** charred branching ground fissure with a pale seam (straight alpha, fills the square, arms reach 0.48 of the width): the crack of a stomp */
  crack: { id: 'vfx_boss_crack_decal', fb: SPR.crack },
  /** tall twisting smoke column, ragged edges (additive-on-black: alpha = brightest channel), portrait 2:3: a streamer inside a smoke plume */
  column: { id: 'vfx_boss_smokecolumn', fb: SPR.smoke3 },
  
  /** a tall standing wall of translucent billowing haze, ragged lumpy top, thin bright streaks running up it, fading at the foot (straight alpha, neutral grey, 341x512): the cards of the nova / slam haze wall */
  hazeWall: { id: 'vfx_boss_hazewall', fb: SPR.smoke3 },
  /** a tall twisting column of smoke pulled upward round a bright narrow core (additive on black, 341x512): the teleport columns */
  tpColumn: { id: 'vfx_boss_tpcolumn', fb: SPR.smoke3 },
  /** a short branching fissure of pale frosted ice, a bright cyan-white seam with a frost halo (straight alpha, 512 square): the ice boss's floor crack (replaces the charred crack decal on snow) */
  frostCrack: { id: 'vfx_boss_frostcrack', fb: SPR.crack },
  
  /** dense fan of fine rays round a white-hot centre (additive on black): the flare core of a slam / nova / enrage burst */
  flareDense: { id: 'vfx_flare_rays_dense_a', fb: SPR.sunburst },
  /** twelve-odd thin spokes with a hot hub (additive on black): the nova's flare (a different silhouette from the slam's dense fan) */
  flareSpokes: { id: 'vfx_starburst_spokes_a', fb: SPR.sunburst },
} as const satisfies Record<string, KitArt>;

export const BOSS_RING_ART = {
  
  ringGrain: { id: 'vfx_ring_grain_soft_a', fb: SPR.glowRing, pk: 0.405 },
  /** ring with fine radial streaks (roar / shock) */
  ringShock: { id: 'vfx_ring_shock_streak_a', fb: SPR.glowRing, pk: 0.345 },
  /** r2: ragged smoke spiral lying on the ground (a dark, feathered vortex; no neon bands). Its visible disc reaches 0.44 of the width */
  vortexDisc: { id: 'vfx_death_spawn_vortex_disc', fb: SPR.glowRing, pk: 0.44 },
  // ---- r3: radial-ray rings (pk = the radius of the ray TIPS as a share of the quad width, measured on the shipped files: size = R / pk puts the tips on R)
  /** ring of 30-odd tapered hazy rays, dark hub (the slam's ray ring) */
  rayHazy: { id: 'vfx_rayring_hazy_a', fb: SPR.sunburst, pk: 0.44 },
  /** ring of short bristling streaks (the enrage burst) */
  rayStreak: { id: 'vfx_rayring_streak_a', fb: SPR.sunburst, pk: 0.45 },
} as const satisfies Record<string, RingArt>;

/** every manifest id the boss presets draw (the carrier specs reference them all; the art test checks the manifest) */
export const BOSS_ART_IDS: readonly string[] = [...new Set([...Object.values(BOSS_ART), ...Object.values(BOSS_RING_ART)].map((a) => a.id))];
