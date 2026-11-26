// Sprites of the self-feedback target `levelup-heal` (level-up, skill-up, potions, heals, revive, death, buffs): every id is a



import type { ArtTex } from '../../spec/types';

// ---- columns / shells

export const ART_STREAK_BUNDLE: ArtTex = { art: 'vfx_streak_column_a', fallback: 'curtain' };
/** wider soft rising streak curtain, no hard margins (shell body, pillar interior) */
export const ART_STREAK_SOFT: ArtTex = { art: 'vfx_streak_rise_soft_a', fallback: 'curtain' };

export const ART_PILLAR_FADE: ArtTex = { art: 'vfx_streak_v_fade_a', fallback: 'streakSoft' };

export const ART_TWOTONE: ArtTex = { art: 'vfx_curtain_streak_twotone_a', fallback: 'curtain' };

export const ART_SHAFTS: ArtTex = { art: 'vfx_curtain_shafts_c', fallback: 'curtain' };

export const ART_CLOUDBAND: ArtTex = { art: 'vfx_cloudband_billow_a', fallback: 'smoke0' };



export const ART_FLOOR_FLARE: ArtTex = { art: 'vfx_levelup_heal_floor_flare', fallback: 'raysSoft' };

export const ART_SKIRT: ArtTex = { art: 'vfx_levelup_heal_skirt', fallback: 'smoke0' };

export const ART_PILLAR_CREAM: ArtTex = { art: 'vfx_levelup_heal_pillar_cream', fallback: 'streakSoft' };


export const ART_FLOOR_FACET: ArtTex = { art: 'vfx_levelup_heal_floor_facet', fallback: 'raysSoft' };
/** r2 generated: a rising soul / spirit wisp: a glowing orb in the lower third with a long curling smoky tail of fine threads going up (player death) */
export const ART_SOUL: ArtTex = { art: 'vfx_levelup_heal_soul_wisp', fallback: 'wisp' };

// ---- ground

export const ART_FLOOR_DISC: ArtTex = { art: 'vfx_disc_rankup_floor_a', fallback: 'glowCore' };
/** 14 bright radial spokes around a hot hub (the spike flare of the floor) */
export const ART_SPOKES: ArtTex = { art: 'vfx_starburst_spokes_a', fallback: 'raysSoft' };
/** fine ragged ray ring with a dark hub (finer second flare) */
export const ART_RAYRING: ArtTex = { art: 'vfx_rayring_hazy_a', fallback: 'raysSoft' };

export const ART_AURA_RING: ArtTex = { art: 'vfx_rayring_hollow_aura_a', fallback: 'raysSoft' };
/** soft luminous ring band (ripples) */
export const ART_RING_BAND: ArtTex = { art: 'vfx_ring_soft_band_a', fallback: 'ringThick' };
/** thinner soft ring band */
export const ART_RING_BAND_B: ArtTex = { art: 'vfx_ring_soft_band_b', fallback: 'ringThick' };

export const ART_RING_THIN: ArtTex = { art: 'vfx_ring_thin_inglow_a', fallback: 'ringInner' };

export const ART_RUNE_RING: ArtTex = { art: 'vfx_ring_scrollwork_lace_a', fallback: 'ornateRing' };

export const ART_SWIRL_RING: ArtTex = { art: 'vfx_ring_ornate_swirl_a', fallback: 'ornateRing' };

export const ART_POOL: ArtTex = { art: 'vfx_glow_orb_smooth_a', fallback: 'glow' };

// ---- sparkles

export const ART_RIM_RED: ArtTex = { art: 'vfx_ring_rimdisc_heal_a', fallback: 'ring' };

export const ART_RIM_BLUE: ArtTex = { art: 'vfx_ring_rimlit_disc_a', fallback: 'ring' };
/** pinpoint glint, halo and 4 hair rays */
export const ART_GLINT: ArtTex = { art: 'vfx_glint_halo_pin_a', fallback: 'sparkle' };

export const ART_STAR: ArtTex = { art: 'vfx_star_cross_halo_a', fallback: 'flare4' };

export const ART_PIP: ArtTex = { art: 'vfx_glow_pip_core_a', fallback: 'dot' };
/** soft round glow */
export const ART_GLOW: ArtTex = { art: 'vfx_glow_blob_soft_a', fallback: 'glow' };

// ---- rings, wisps, smoke
/** soft double halo ring, luminous band (a ripple that is never a hairline) */
export const ART_HALO_RING: ArtTex = { art: 'vfx_ring_halo_twin_a', fallback: 'ringThick' };

export const ART_WIND: ArtTex = { art: 'vfx_streak_wind_soft_a', fallback: 'streakSoft' };
/** smoky swirl ball (soul / spirit wisps) */
export const ART_WISP_BALL: ArtTex = { art: 'vfx_wisp_swirl_ball_a', fallback: 'wisp' };
/** sparse soft dust / smoke puff (alpha) */
export const ART_SMOKE_PUFF: ArtTex = { art: 'vfx_smoke_dustpuff_a', fallback: 'smoke0' };
/** dense billowing smoke ball (alpha) */
export const ART_SMOKE_LUMP: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke2' };
/** lens-flare pin: a hot point with a halo and hair rays */
export const ART_PIN_LENS: ArtTex = { art: 'vfx_sparkle_pin_lens_a', fallback: 'sparkle' };


// shipped; the codex window was used up in r2, DEFERRED_GEN.txt lists what a regeneration would still improve)

export const ART_WALL_B: ArtTex = { art: 'vfx_curtain_shafts_b', fallback: 'curtain' };
/** shorter, denser shaft wall (second skirt pass, auto-potion crown) */
export const ART_WALL_A: ArtTex = { art: 'vfx_curtain_shafts_a', fallback: 'curtain' };
/** low ragged shaft wall (crown tips) */
export const ART_WALL_C: ArtTex = { art: 'vfx_curtain_shafts_c', fallback: 'curtain' };
/** crown of 14 crisp triangular light spikes round a dark hub (the faceted level-up floor flare) */
export const ART_CROWN: ArtTex = { art: 'vfx_ring_spiked_crown_a', fallback: 'raysSoft' };
/** fine hair rays round a hollow hub (level-up floor fringe) */
export const ART_RAYS_INNER: ArtTex = { art: 'vfx_ring_rays_inner_a', fallback: 'raysSoft' };
/** bristling fuzzy ring of fine spikes (floor fringe, auto-potion splash ring) */
export const ART_FUZZY_SPIKES: ArtTex = { art: 'vfx_ring_fuzzy_spikes_a', fallback: 'raysSoft' };

export const ART_GLOW_RAYS_RING: ArtTex = { art: 'vfx_ring_glow_rays_a', fallback: 'ringThick' };
/** bristle-edged ring seen from above (splash crown of the auto potions) */
export const ART_BRISTLE: ArtTex = { art: 'vfx_ring_splash_bristle_a', fallback: 'ringThick' };
/** ray corona round a dark hub */
export const ART_CORONA: ArtTex = { art: 'vfx_rayring_corona_a', fallback: 'raysSoft' };
/** warm soft floor disc, hot in the middle (level-up gold floor heart) */
export const ART_DISC_WARM: ArtTex = { art: 'vfx_disc_warm_floor_a', fallback: 'glowCore' };
/** engraved scroll ring, a different scroll from the lace (revive rune carpet) */
export const ART_SCROLL_RING: ArtTex = { art: 'vfx_ring_ornate_scroll_a', fallback: 'ornateRing' };
/** twin thin ring (shield outline) */
export const ART_DOUBLE_RING: ArtTex = { art: 'vfx_ring_double_thin_a', fallback: 'ringThick' };
/** swirling arcs ring (haste) */
export const ART_SWIRL_ARCS: ArtTex = { art: 'vfx_swirl_ring_arcs_a', fallback: 'ornateRing' };
/** ring of speed dashes (haste) */
export const ART_DASH_RING: ArtTex = { art: 'vfx_ring_dashes_a', fallback: 'ringThick' };
/** tangle of smoke threads (soul smoke) */
export const ART_WISP_TANGLE: ArtTex = { art: 'vfx_wisp_tangle_a', fallback: 'wisp' };
/** comet bundle: a soft head and a long streaky tail to the left (soul tail, drawn rotated upright) */
export const ART_COMET: ArtTex = { art: 'vfx_smear_comet_bundle_a', fallback: 'streakSoft' };
/** hot soft orb core */
export const ART_ORB_CORE: ArtTex = { art: 'vfx_glow_orb_core_a', fallback: 'glow' };
/** dust-haze round puff (alpha body under floor glows) */
export const ART_HAZE: ArtTex = { art: 'vfx_puff_haze_round_a', fallback: 'smoke0' };
/** soft grainy ring band */
export const ART_RING_GRAIN: ArtTex = { art: 'vfx_ring_grain_soft_a', fallback: 'ringThick' };
/** thick soft ring */
export const ART_RING_THICK: ArtTex = { art: 'vfx_ring_thick_soft_a', fallback: 'ringThick' };
/** ragged smoke ring (stealth floor) */
export const ART_SMOKE_RING: ArtTex = { art: 'vfx_ring_smoke_ragged_a', fallback: 'smoke0' };
/** curling swirl arms (stealth / vortex) */
export const ART_VORTEX_SMOKE: ArtTex = { art: 'vfx_vortex_smoke_ring_a', fallback: 'smoke0' };

// ---- r3 (2026-10-22): generated in the night of 10-20 (r2 DEFERRED_GEN lines 1-4), shipped, wired in r3
/** dense tileable body streaks (~55 % coverage, full height, bright at the bottom edge): the translucent glass body of a shell (alpha copies of every hue carrier) */
export const ART_BODY_STREAKS: ArtTex = { art: 'vfx_levelup_heal_body_streaks', fallback: 'curtain' };
/** top-down flare: a fine ragged burst of many thin spikes round a solid hub (the second level-up floor flare, flat spikes) */
export const ART_FLOOR_FACET_B: ArtTex = { art: 'vfx_levelup_heal_floor_facet_b', fallback: 'raysSoft' };

export const ART_SKILLUP_COLUMN: ArtTex = { art: 'vfx_levelup_heal_skillup_column', fallback: 'curtain' };
/** wall of long fine light streaks standing on a bright base rim (drug-up skirt / spike fan), tileable */
export const ART_SKIRT_WALL: ArtTex = { art: 'vfx_levelup_heal_skirt_wall', fallback: 'curtain' };

/** smooth glowing ring band with a slightly broken inner edge, nothing spiky (skill-up floor bands) */
export const ART_RING_GLOW_BAND: ArtTex = { art: 'vfx_ring_glow_band_a', fallback: 'ringThick' };

/** dome of flame-like strands (upright billboard: the splash dome of the auto potions) */
export const ART_SPLASH_DOME: ArtTex = { art: 'vfx_splash_dome_top_a', fallback: 'smoke0' };

/** every manifest id this target draws (test / audit list) */
export const LH_ART_IDS = [...new Set([
  ART_FLOOR_FLARE, ART_SKIRT, ART_PILLAR_CREAM, ART_STREAK_BUNDLE, ART_STREAK_SOFT, ART_PILLAR_FADE, ART_TWOTONE, ART_SHAFTS, ART_CLOUDBAND, ART_FLOOR_DISC, ART_SPOKES, ART_RAYRING,
  ART_AURA_RING, ART_RING_BAND, ART_RING_BAND_B, ART_RING_THIN, ART_RUNE_RING, ART_SWIRL_RING, ART_POOL, ART_RIM_RED, ART_RIM_BLUE,
  ART_GLINT, ART_STAR, ART_PIP, ART_GLOW, ART_HALO_RING, ART_WIND, ART_WISP_BALL, ART_SMOKE_PUFF, ART_SMOKE_LUMP, ART_PIN_LENS,
  ART_WALL_B, ART_WALL_A, ART_WALL_C, ART_CROWN, ART_RAYS_INNER, ART_FUZZY_SPIKES, ART_GLOW_RAYS_RING, ART_BRISTLE, ART_CORONA, ART_DISC_WARM,
  ART_SCROLL_RING, ART_DOUBLE_RING, ART_SWIRL_ARCS, ART_DASH_RING, ART_WISP_TANGLE, ART_COMET, ART_ORB_CORE, ART_HAZE, ART_RING_GRAIN, ART_RING_THICK,
  ART_SMOKE_RING, ART_VORTEX_SMOKE, ART_FLOOR_FACET, ART_SOUL, ART_BODY_STREAKS, ART_FLOOR_FACET_B, ART_SKILLUP_COLUMN, ART_SKIRT_WALL, ART_RING_GLOW_BAND, ART_SPLASH_DOME,
].map((a) => a.art as string))];
